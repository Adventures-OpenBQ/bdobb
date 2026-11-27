// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use super::{WireNumber, WireValue};
use serde::{
    de::{self, DeserializeSeed, MapAccess, SeqAccess, Visitor},
    Deserialize,
};
use std::fmt;

// Retain the original buffered decoder when value precedes tag. This preserves
// field-order flexibility without buffering the common tag-first payload.
fn legacy<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<WireValue, D::Error> {
    #[derive(Deserialize)]
    #[serde(tag = "tag", deny_unknown_fields)]
    enum StrictValue {
        #[serde(rename = "missing")]
        Missing {},
        #[serde(rename = "null")]
        Null {},
        #[serde(rename = "bool")]
        Bool { value: bool },
        #[serde(rename = "string")]
        String { value: String },
        #[serde(rename = "f64")]
        F64 { value: WireNumber },
        #[serde(rename = "bigint-string")]
        BigIntString { value: String },
        #[serde(rename = "array")]
        Array { value: Vec<WireValue> },
        #[serde(rename = "record")]
        Record { value: Vec<(String, WireValue)> },
    }
    Ok(match StrictValue::deserialize(deserializer)? {
        StrictValue::Missing {} => WireValue::Missing,
        StrictValue::Null {} => WireValue::Null,
        StrictValue::Bool { value } => WireValue::Bool(value),
        StrictValue::String { value } => WireValue::String(value),
        StrictValue::F64 { value } => WireValue::F64(value),
        StrictValue::BigIntString { value } => WireValue::BigIntString(value),
        StrictValue::Array { value } => WireValue::Array(value),
        StrictValue::Record { value } => WireValue::Record(value),
    })
}

#[derive(Deserialize)]
#[serde(field_identifier)]
enum Field {
    #[serde(rename = "tag")]
    Tag,
    #[serde(rename = "value")]
    Value,
    #[serde(other)]
    Other,
}
#[derive(Deserialize)]
#[serde(field_identifier)]
enum Tag {
    #[serde(rename = "missing")]
    Missing,
    #[serde(rename = "null")]
    Null,
    #[serde(rename = "bool")]
    Bool,
    #[serde(rename = "string")]
    String,
    #[serde(rename = "f64")]
    F64,
    #[serde(rename = "bigint-string")]
    BigIntString,
    #[serde(rename = "array")]
    Array,
    #[serde(rename = "record")]
    Record,
}
// The first key has been read, but its value has not. Replay just that key to
// the original decoder; all payloads and subsequent keys remain in the stream.
struct ValueFirst<M> {
    map: M,
    pending: bool,
}
impl<'de, M: MapAccess<'de>> MapAccess<'de> for ValueFirst<M> {
    type Error = M::Error;
    fn next_key_seed<K: DeserializeSeed<'de>>(
        &mut self,
        seed: K,
    ) -> Result<Option<K::Value>, Self::Error> {
        if self.pending {
            self.pending = false;
            seed.deserialize(de::value::StrDeserializer::<M::Error>::new("value"))
                .map(Some)
        } else {
            self.map.next_key_seed(seed)
        }
    }
    fn next_value_seed<V: DeserializeSeed<'de>>(
        &mut self,
        seed: V,
    ) -> Result<V::Value, Self::Error> {
        self.map.next_value_seed(seed)
    }
}
struct WireVisitor;
impl<'de> Visitor<'de> for WireVisitor {
    type Value = WireValue;
    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("a tagged wire value")
    }
    fn visit_seq<S: SeqAccess<'de>>(self, seq: S) -> Result<Self::Value, S::Error> {
        legacy(de::value::SeqAccessDeserializer::new(seq))
    }
    fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
        match map.next_key::<Field>()? {
            Some(Field::Value) => {
                return legacy(de::value::MapAccessDeserializer::new(ValueFirst {
                    map,
                    pending: true,
                }))
            }
            Some(Field::Tag) => {}
            Some(Field::Other) => return Err(de::Error::custom("Unknown wire value field")),
            None => return Err(de::Error::missing_field("tag")),
        }
        let tag = map.next_value::<Tag>()?;
        let value = match tag {
            Tag::Missing => WireValue::Missing,
            Tag::Null => WireValue::Null,
            _ => {
                match map.next_key::<Field>()? {
                    Some(Field::Value) => {}
                    Some(Field::Tag) => return Err(de::Error::duplicate_field("tag")),
                    Some(Field::Other) => {
                        return Err(de::Error::custom("Unknown wire value field"))
                    }
                    None => return Err(de::Error::missing_field("value")),
                }
                match tag {
                    Tag::Bool => WireValue::Bool(map.next_value()?),
                    Tag::String => WireValue::String(map.next_value()?),
                    Tag::F64 => WireValue::F64(map.next_value()?),
                    Tag::BigIntString => WireValue::BigIntString(map.next_value()?),
                    Tag::Array => WireValue::Array(map.next_value()?),
                    Tag::Record => WireValue::Record(map.next_value()?),
                    Tag::Missing | Tag::Null => unreachable!(),
                }
            }
        };
        if map.next_key::<Field>()?.is_some() {
            return Err(de::Error::custom(
                "Unexpected or duplicate wire value field",
            ));
        }
        Ok(value)
    }
}
impl<'de> Deserialize<'de> for WireValue {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(WireVisitor)
    }
}

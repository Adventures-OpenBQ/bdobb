// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use pivot_core::{contract::*, validation::*};
#[test]
fn missing_null_bigint_records_and_array_positions_round_trip() {
    let raw = r#"{"tag":"record","value":[["__proto__",{"tag":"string","value":"ordinary"}],["missing",{"tag":"missing"}],["null",{"tag":"null"}],["exact",{"tag":"bigint-string","value":"9007199254740993"}],["array",{"tag":"array","value":[{"tag":"missing"},{"tag":"null"}]}]]}"#;
    let value: WireValue = serde_json::from_str(raw).unwrap();
    validate_wire_value(&value).unwrap();
    assert_eq!(serde_json::to_string(&value).unwrap(), raw);
}
#[test]
fn f64_values_parse_to_the_nearest_double() {
    // Without serde_json's float_roundtrip these come back one ULP off.
    for (raw, expected) in [
        ("394301.33835633675", 394301.33835633675_f64),
        ("1.0715660391465826e-75", 1.0715660391465826e-75),
    ] {
        let value: WireValue =
            serde_json::from_str(&format!(r#"{{"tag":"f64","value":{raw}}}"#)).unwrap();
        let WireValue::F64(WireNumber::Finite(parsed)) = value else {
            panic!("{raw}")
        };
        assert_eq!(parsed.to_bits(), expected.to_bits(), "{raw}");
    }
}
#[test]
fn tagged_nonfinite_values_survive_transport_but_refuse_arithmetic() {
    for tag in ["NaN", "Infinity", "-Infinity"] {
        let raw = format!(r#"{{"tag":"f64","value":"{tag}"}}"#);
        let value: WireValue = serde_json::from_str(&raw).unwrap();
        validate_wire_value(&value).unwrap();
        assert_eq!(serde_json::to_string(&value).unwrap(), raw);
        assert_eq!(arithmetic_number(&value).unwrap_err().code, "nonfinite");
    }
    let minus_zero: WireValue = serde_json::from_str(r#"{"tag":"f64","value":"-0"}"#).unwrap();
    assert!(arithmetic_number(&minus_zero).unwrap().is_sign_negative());
    for raw in [
        r#"{"tag":"string","value":"2"}"#,
        r#"{"tag":"null"}"#,
        r#"{"tag":"bigint-string","value":"2"}"#,
    ] {
        assert_eq!(
            arithmetic_number(&serde_json::from_str(raw).unwrap())
                .unwrap_err()
                .code,
            "invalid-type"
        );
    }
}
#[test]
fn malformed_values_and_unknown_versions_refuse() {
    for raw in [
        r#"{"tag":"f64","value":"other"}"#,
        r#"{"tag":"missing","value":0}"#,
        r#"{"tag":"wat"}"#,
    ] {
        assert!(serde_json::from_str::<WireValue>(raw).is_err());
    }
    for raw in [
        r#"{"tag":"bigint-string","value":"1.2"}"#,
        r#"{"tag":"record","value":[["x",{"tag":"null"}],["x",{"tag":"null"}]]}"#,
    ] {
        assert!(validate_wire_value(&serde_json::from_str(raw).unwrap()).is_err());
    }
    let mut definition: WireDefinition = serde_json::from_str(
        r#"{"protocolVersion":1,"locale":"en-US","definition":{"table":{},"search":""}}"#,
    )
    .unwrap();
    assert!(validate_definition(&definition).is_ok());
    definition.protocol_version = 2;
    assert_eq!(
        validate_definition(&definition).unwrap_err().code,
        "unsupported-protocol"
    );
    definition.protocol_version = 1;
    definition.definition.analytical=Some(AnalyticalDefinition::Table(Box::new(serde_json::from_str(r#"{"schemaVersion":2,"enabled":true,"params":{"promotePage":true,"filters":[]},"categories":[],"measures":[],"formulas":[],"layout":{"rows":[],"columns":[],"values":[]},"checklists":[],"resultFilters":[],"subtotals":{"grandTotal":true,"groups":true}}"#).unwrap())));
    assert_eq!(
        validate_definition(&definition).unwrap_err().code,
        "unsupported-schema"
    );
}
#[test]
fn structural_validation_checks_layout_ids_arity_and_nonfinite_literals() {
    let raw = r#"{"protocolVersion":1,"locale":"en-US","definition":{"table":{},"search":"","analytical":{"schemaVersion":1,"enabled":true,"params":{"promotePage":true,"filters":[]},"categories":[{"id":"region","name":"Region","sourceFieldId":"region","transform":"native"}],"measures":[{"id":"sum","sourceFieldId":"x","aggregation":"sum"}],"formulas":[],"layout":{"rows":["region"],"columns":[],"values":["sum"]},"checklists":[],"resultFilters":[],"subtotals":{"grandTotal":true,"groups":true}}}}"#;
    let mut definition: WireDefinition = serde_json::from_str(raw).unwrap();
    assert!(validate_definition(&definition).is_ok());
    let model = definition
        .definition
        .analytical
        .as_mut()
        .unwrap()
        .table_mut()
        .unwrap();
    model.layout.columns.push("region".into());
    assert_eq!(
        validate_definition(&definition).unwrap_err().code,
        "invalid-structure"
    );
    definition
        .definition
        .analytical
        .as_mut()
        .unwrap()
        .table_mut()
        .unwrap()
        .layout
        .columns
        .clear();
    definition
        .definition
        .analytical
        .as_mut()
        .unwrap()
        .table_mut()
        .unwrap()
        .layout
        .values
        .push("absent".into());
    assert_eq!(
        validate_definition(&definition).unwrap_err().code,
        "missing-reference"
    );
    definition
        .definition
        .analytical
        .as_mut()
        .unwrap()
        .table_mut()
        .unwrap()
        .layout
        .values
        .pop();
    definition
        .definition
        .analytical
        .as_mut()
        .unwrap()
        .table_mut()
        .unwrap()
        .formulas
        .push(Formula {
            id: "formula".into(),
            name: "Formula".into(),
            scope: FormulaScope::Aggregate,
            expression: "".into(),
            format: None,
            ast: FormulaAst::Call {
                function: FormulaFunction::Sum,
                args: vec![],
            },
        });
    assert_eq!(
        validate_definition(&definition).unwrap_err().code,
        "invalid-ast"
    );
    definition
        .definition
        .analytical
        .as_mut()
        .unwrap()
        .table_mut()
        .unwrap()
        .formulas[0]
        .ast = FormulaAst::Literal {
        value: Literal::Number(f64::INFINITY),
    };
    assert_eq!(
        validate_definition(&definition).unwrap_err().code,
        "invalid-ast"
    );
}
#[test]
fn saved_legacy_definition_and_source_metadata_preserve_omission() {
    let raw = r#"{"protocolVersion":1,"locale":"en-US","definition":{"table":{"pivot":{"enabled":false,"grouping":["date"],"split":[],"buckets":{"date":"year"},"aggregationFns":{"revenue":"sum"}},"columnOrder":["date","revenue"],"pinned":{"date":null}},"search":""}}"#;
    let definition: WireDefinition = serde_json::from_str(raw).unwrap();
    validate_definition(&definition).unwrap();
    let output = serde_json::to_value(definition).unwrap();
    assert_eq!(
        output,
        serde_json::from_str::<serde_json::Value>(raw).unwrap()
    );
    let input = r#"{"rows":[{"id":"r","values":{"missing":{"tag":"missing"},"exact":{"tag":"bigint-string","value":"9007199254740993"}}}],"columns":[{"id":"exact","label":"Exact","metadata":{"__proto__":{"tag":"string","value":"ordinary"}}}],"resultRevision":1,"outputRevision":2,"provenance":{"sourceWidgetId":"source","metadata":{"fiscal":{"tag":"null"}}},"completeness":{"kind":"partial","warnings":["bounded"],"acquiredRowCount":1,"totalRowCount":10,"totalRowCountKind":"estimated"},"freshness":{"availability":"available","stale":true}}"#;
    let data: SourceDataset = serde_json::from_str(input).unwrap();
    assert!(!data.rows[0].values.contains_key("absent"));
    assert_eq!(data.rows[0].values["missing"], WireValue::Missing);
    assert_eq!(
        serde_json::to_value(data).unwrap(),
        serde_json::from_str::<serde_json::Value>(input).unwrap()
    );
}

#[test]
fn unit_tags_reject_any_content_including_null_in_both_field_orders() {
    for raw in [
        r#"{"tag":"missing","value":null}"#,
        r#"{"tag":"null","value":null}"#,
        r#"{"tag":"missing","value":1}"#,
        r#"{"tag":"null","value":1}"#,
        r#"{"value":null,"tag":"missing"}"#,
        r#"{"value":null,"tag":"null"}"#,
    ] {
        assert!(
            serde_json::from_str::<WireValue>(raw).is_err(),
            "accepted {raw}"
        );
    }
}
fn definition_with_ast(ast: FormulaAst) -> WireDefinition {
    let mut definition: WireDefinition = serde_json::from_str(r#"{"protocolVersion":1,"locale":"en-US","definition":{"table":{},"search":"","analytical":{"schemaVersion":1,"enabled":true,"params":{"promotePage":true,"filters":[]},"categories":[],"measures":[],"formulas":[],"layout":{"rows":[],"columns":[],"values":[]},"checklists":[],"resultFilters":[],"subtotals":{"grandTotal":true,"groups":true}}}}"#).unwrap();
    definition
        .definition
        .analytical
        .as_mut()
        .unwrap()
        .table_mut()
        .unwrap()
        .formulas
        .push(Formula {
            id: "formula".into(),
            name: "Formula".into(),
            scope: FormulaScope::Source,
            expression: "".into(),
            ast,
            format: None,
        });
    definition
}
#[test]
fn ast_text_limit_counts_cumulative_utf8_literal_reference_and_member_strings() {
    let literal = |text: String| FormulaAst::Literal {
        value: Literal::String(text),
    };
    let exact = definition_with_ast(literal("é".repeat(8192)));
    assert!(validate_definition(&exact).is_ok());
    let over = definition_with_ast(literal(format!("{}a", "é".repeat(8192))));
    assert_eq!(
        validate_definition(&over)
            .expect_err("oversized literal must refuse")
            .code,
        "expression-limit"
    );
    // Neither string exceeds the limit alone: the running total must cross it.
    let cumulative = definition_with_ast(FormulaAst::Binary {
        operator: BinaryOperator::Add,
        left: Box::new(literal("a".repeat(16380))),
        right: Box::new(FormulaAst::Reference {
            target: ReferenceTarget::Field,
            id: "field".into(),
        }),
    });
    assert_eq!(
        validate_definition(&cumulative)
            .expect_err("cumulative strings must refuse")
            .code,
        "expression-limit"
    );
    let mut member = definition_with_ast(FormulaAst::Member {
        value: Box::new(literal("a".repeat(16381))),
        selectors: vec![MemberSelector {
            category_id: "c".into(),
            member_key: "xyz".into(),
        }],
    });
    member
        .definition
        .analytical
        .as_mut()
        .unwrap()
        .table_mut()
        .unwrap()
        .categories
        .push(Category {
            id: "c".into(),
            name: "C".into(),
            source_field_id: "x".into(),
            transform: Transform::Native,
            fiscal_binding: None,
            legacy_bucket: None,
        });
    assert_eq!(
        validate_definition(&member)
            .expect_err("member strings must count toward the limit")
            .code,
        "expression-limit"
    );
}
#[test]
fn ast_selector_arrays_preserve_the_baseline_1024_entry_limit() {
    for (count, accepted) in [(1024, true), (1025, false)] {
        let mut definition = definition_with_ast(FormulaAst::Member {
            value: Box::new(FormulaAst::Literal {
                value: Literal::Number(1.0),
            }),
            selectors: (0..count)
                .map(|i| MemberSelector {
                    category_id: format!("c{i}"),
                    member_key: "x".into(),
                })
                .collect(),
        });
        definition
            .definition
            .analytical
            .as_mut()
            .unwrap()
            .table_mut()
            .unwrap()
            .categories = (0..count)
            .map(|i| Category {
                id: format!("c{i}"),
                name: "C".into(),
                source_field_id: "x".into(),
                transform: Transform::Native,
                fiscal_binding: None,
                legacy_bucket: None,
            })
            .collect();
        let result = validate_definition(&definition);
        if accepted {
            assert!(result.is_ok());
        } else {
            assert_eq!(
                result
                    .expect_err("oversized selector array must refuse")
                    .code,
                "node-limit"
            );
        }
    }
}
#[test]
fn recipe_equivalence_normalizes_zero_sign_but_keeps_typed_literal_and_refuses_forgery() {
    let mut model: serde_json::Value = serde_json::json!({"schemaVersion":1,"enabled":false,"params":{"promotePage":false,"filters":[]},"categories":[],"measures":[],"formulas":[{"id":"zero","name":"Zero","scope":"source","expression":"-0","ast":{"kind":"literal","value":-0.0}}],"layout":{"rows":[],"columns":[],"values":[]},"checklists":[],"resultFilters":[],"subtotals":{"grandTotal":true,"groups":true}});
    let typed: pivot_core::contract::TableModel = serde_json::from_value(model.clone()).unwrap();
    model["formulas"][0]["ast"]["value"] = serde_json::json!(0.0);
    fn tagged(value: &serde_json::Value) -> pivot_core::contract::WireValue {
        use pivot_core::contract::*;
        match value {
            serde_json::Value::Null => WireValue::Null,
            serde_json::Value::Bool(v) => WireValue::Bool(*v),
            serde_json::Value::Number(v) => WireValue::F64(WireNumber::Finite(v.as_f64().unwrap())),
            serde_json::Value::String(v) => WireValue::String(v.clone()),
            serde_json::Value::Array(v) => WireValue::Array(v.iter().map(tagged).collect()),
            serde_json::Value::Object(v) => {
                WireValue::Record(v.iter().map(|(k, v)| (k.clone(), tagged(v))).collect())
            }
        }
    }
    let proof = tagged(&model);
    pivot_core::validation::validate_recipe_source(&proof, &typed).unwrap();
    let pivot_core::contract::FormulaAst::Literal {
        value: pivot_core::contract::Literal::Number(zero),
    } = &typed.formulas[0].ast
    else {
        panic!("literal")
    };
    assert!(*zero == 0. && zero.is_sign_negative());
    model["formulas"][0]["ast"]["value"] = serde_json::json!(1.0);
    assert!(pivot_core::validation::validate_recipe_source(&tagged(&model), &typed).is_err());
}

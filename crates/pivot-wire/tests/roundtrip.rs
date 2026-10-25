// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use pivot_core::{contract::*, session::*};
use pivot_wire::{decode_request, encode_response};
use serde_json::{json, Value};

fn revision() -> Value {
    json!({"widgetId":"widget","input":2,"model":3,"output":4})
}
fn envelope(mut command: Value) -> Value {
    command["requestId"] = json!("request-7");
    command["revision"] = revision();
    json!({"protocolVersion":1,"sessionId":17,"request":command})
}
fn input() -> Value {
    json!({
        "rows":[{"id":"row","values":{
            "missing":{"tag":"missing"},"null":{"tag":"null"},
            "nan":{"tag":"f64","value":"NaN"},"inf":{"tag":"f64","value":"Infinity"},
            "negativeInf":{"tag":"f64","value":"-Infinity"},"negativeZero":{"tag":"f64","value":"-0"},
            "big":{"tag":"bigint-string","value":"9007199254740993"},
            "nested":{"tag":"record","value":[["__proto__",{"tag":"array","value":[{"tag":"missing"},{"tag":"null"}]}]]}
        }}],
        "columns":[{"id":"missing","label":"Missing"}],"resultRevision":2,"outputRevision":4,
        "provenance":{"sourceWidgetId":"source","metadata":{"fiscal":{"tag":"null"}}},
        "completeness":{"kind":"partial","warnings":["bounded"],"acquiredRowCount":1,"totalRowCount":10,"totalRowCountKind":"estimated"},
        "freshness":{"availability":"available","stale":true}
    })
}
fn definition() -> Value {
    json!({"protocolVersion":1,"locale":"en-US","definition":{
        "table":{},"search":"","analytical":{
            "schemaVersion":1,"enabled":true,"params":{"promotePage":true,"filters":[]},
            "categories":[{"id":"fy","name":"Fiscal year","sourceFieldId":"date","transform":"FY",
                "fiscalBinding":{"companyFieldId":"company","dateFieldId":"date","metadataKey":"fiscal","periodKind":"FY",
                    "periodStartFieldId":"start","periodEndFieldId":"end","fiscalYearFieldId":"year","fiscalQuarterFieldId":"quarter"}}],
            "measures":[],"formulas":[{"id":"twice","name":"Twice","scope":"source","expression":"[revenue] * 2",
                "format":"number","ast":{"kind":"binary","operator":"*","left":{"kind":"reference","target":"field","id":"revenue"},"right":{"kind":"literal","value":2.0}}}],
            "layout":{"rows":["fy"],"columns":[],"values":[]},"checklists":[],"resultFilters":[],"subtotals":{"grandTotal":true,"groups":true}
        }
    }})
}
fn response(result: Response) -> CoreResponse {
    CoreResponse {
        request_id: "request-7".into(),
        revision: serde_json::from_value(revision()).unwrap(),
        completeness: serde_json::from_value(json!({"kind":"complete","warnings":[]})).unwrap(),
        diagnostics: vec![],
        model_warnings: None,
        model_warning_count: None,
        result,
    }
}

// Removing the shared request conversion or normalizing a tagged value loses source data.
#[test]
fn registered_values_roundtrip_through_the_existing_chart_payload() {
    let expected = input();
    let request = decode_request(
        &envelope(json!({"kind":"registerInput","input":expected,"inputRevision":2})).to_string(),
    )
    .unwrap();
    assert_eq!(request.request_id, "request-7");
    assert_eq!(serde_json::to_value(&request.revision).unwrap(), revision());
    let Operation::RegisterInput {
        input,
        input_revision,
    } = request.operation
    else {
        panic!("register input")
    };
    assert_eq!(input_revision, 2);
    let encoded: Value =
        serde_json::from_str(&encode_response(17, response(Response::ChartData(input))).unwrap())
            .unwrap();
    let mut payload = expected;
    for (key, value) in
        json!({"kind":"chartData","requestId":"request-7","revision":revision(),"diagnostics":[]})
            .as_object()
            .unwrap()
    {
        payload[key] = value.clone();
    }
    // Dataset completeness occupies the same field in the existing flattened response.
    assert_eq!(
        encoded,
        json!({"protocolVersion":1,"sessionId":17,"response":payload})
    );
    assert!(encoded["response"]["rows"][0]["values"]
        .get("absent")
        .is_none());
}

// Dropping definition fields during conversion would change fiscal or formula execution.
#[test]
fn formula_and_fiscal_definitions_survive_decoding() {
    let expected = definition();
    let request = decode_request(
        &envelope(json!({"kind":"previewDefinition","definition":expected})).to_string(),
    )
    .unwrap();
    let Operation::PreviewDefinition(actual) = request.operation else {
        panic!("preview definition")
    };
    assert_eq!(actual.locale, "en-US");
    assert_eq!(
        serde_json::to_value(actual.definition).unwrap(),
        expected["definition"]
    );
}

#[test]
fn formula_binding_preserves_the_draft_and_scoped_references() {
    let request = decode_request(&envelope(json!({"kind":"bindFormula","definition":definition(),
        "draft":{"id":"f","name":"F","scope":"aggregate","expression":"SUM([Revenue])","format":"number"},
        "bindings":[{"scope":"source","name":"Revenue","reference":{"kind":"reference","target":"field","id":"revenue"}}]
    })).to_string()).unwrap();
    let Operation::BindFormula {
        draft, bindings, ..
    } = request.operation
    else {
        panic!("formula binding")
    };
    assert_eq!(draft.expression, "SUM([Revenue])");
    assert!(matches!(draft.scope, FormulaScope::Aggregate));
    assert_eq!(draft.format.as_deref(), Some("number"));
    assert_eq!(bindings.len(), 1);
    assert_eq!(bindings[0].name, "Revenue");
    assert!(matches!(bindings[0].scope, FormulaScope::Source));
    assert_eq!(
        serde_json::to_value(&bindings[0].reference).unwrap(),
        json!({"kind":"reference","target":"field","id":"revenue"})
    );
}

#[test]
fn formula_draft_and_bindings_reject_unknown_fields_and_allow_omitted_format() {
    let bind = |draft: Value, binding: Value| {
        decode_request(
            &envelope(json!({"kind":"bindFormula","definition":definition(),
            "draft":draft,"bindings":[binding]}))
            .to_string(),
        )
    };
    let draft = json!({"id":"f","name":"F","scope":"aggregate","expression":"1"});
    let binding = json!({"scope":"source","name":"R","reference":{"kind":"reference","target":"field","id":"r"}});
    assert!(bind(draft.clone(), binding.clone()).is_ok());
    let mut extra = draft.clone();
    extra["extra"] = json!(1);
    assert!(bind(extra, binding.clone())
        .unwrap_err()
        .contains("unknown field `extra`"));
    let mut extra = binding.clone();
    extra["extra"] = json!(1);
    assert!(bind(draft.clone(), extra)
        .unwrap_err()
        .contains("unknown field `extra`"));
    let mut missing = draft.clone();
    missing.as_object_mut().unwrap().remove("expression");
    assert!(bind(missing, binding)
        .unwrap_err()
        .contains("missing field `expression`"));
}

// Diagnostics must retain original codes and all evidence, including optional false/zero.
#[test]
fn error_diagnostics_and_model_warnings_preserve_the_worker_envelope() {
    let diagnostic = json!({"code":"fiscal-incomplete","message":"Missing period","severity":"warning","path":"categories.fy",
        "definitionId":"fy","dependencyId":"date","key":"A","memberKeys":["FY2026"],"unmatchedCount":0,"truncated":false});
    let warning = json!({"code":"fiscal-incomplete","message":"Missing period","categoryId":"fy","periodCount":2,"origin":revision()});
    let mut value = response(Response::Error(
        serde_json::from_value(diagnostic.clone()).unwrap(),
    ));
    value.diagnostics = vec![serde_json::from_value(diagnostic.clone()).unwrap()];
    value.model_warnings = Some(vec![serde_json::from_value(warning.clone()).unwrap()]);
    value.model_warning_count = Some(2);
    let encoded: Value = serde_json::from_str(&encode_response(17, value).unwrap()).unwrap();
    assert_eq!(
        encoded,
        json!({"protocolVersion":1,"sessionId":17,"response":{
            "kind":"error","requestId":"request-7","revision":revision(),"completeness":{"kind":"complete","warnings":[]},
            "diagnostics":[diagnostic],"error":diagnostic,"modelWarnings":[warning],"modelWarningCount":2
        }})
    );
}

#[test]
fn omitted_optional_response_evidence_stays_omitted() {
    let encoded: Value =
        serde_json::from_str(&encode_response(17, response(Response::Registered)).unwrap())
            .unwrap();
    assert_eq!(
        encoded,
        json!({"protocolVersion":1,"sessionId":17,"response":{
            "kind":"registered","requestId":"request-7","revision":revision(),"completeness":{"kind":"complete","warnings":[]},"diagnostics":[]
        }})
    );
}

#[test]
fn invalid_protocol_and_unknown_envelope_command_and_nested_fields_fail() {
    let valid = envelope(json!({"kind":"rows","request":{"groupPath":[],"offset":0,"limit":20}}));
    assert!(matches!(
        decode_request(&valid.to_string()).unwrap().operation,
        Operation::Rows(_)
    ));
    for location in ["protocol", "envelope", "command", "revision", "rowRequest"] {
        let mut invalid = valid.clone();
        match location {
            "protocol" => invalid["protocolVersion"] = json!(2),
            "envelope" => invalid["extra"] = json!(true),
            "command" => invalid["request"]["extra"] = json!(true),
            "revision" => invalid["request"]["revision"]["extra"] = json!(true),
            _ => invalid["request"]["request"]["extra"] = json!(true),
        }
        assert!(
            decode_request(&invalid.to_string()).is_err(),
            "accepted {location}"
        );
    }
    for kind in [
        "registerInput",
        "importFile",
        "inputSchema",
        "applyModel",
        "previewDefinition",
        "bindFormula",
        "memberDomain",
        "identityWitness",
        "selection",
        "rows",
        "facets",
        "inspect",
        "totals",
        "chartData",
        "presented",
        "nextSubset",
        "cancel",
        "dispose",
    ] {
        let invalid = envelope(json!({"kind":kind,"extra":true}));
        assert!(
            decode_request(&invalid.to_string())
                .unwrap_err()
                .contains("Unknown request field"),
            "kind {kind}"
        );
    }
    let mut invalid = definition();
    invalid["definition"]["extra"] = json!(true);
    assert!(decode_request(
        &envelope(json!({"kind":"previewDefinition","definition":invalid})).to_string()
    )
    .is_err());
}

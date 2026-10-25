// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use pivot_core::{contract::*, formulas::*};
use std::collections::BTreeMap;
fn lit(n: f64) -> FormulaAst {
    FormulaAst::Literal {
        value: Literal::Number(n),
    }
}
fn reference(target: ReferenceTarget, id: &str) -> FormulaAst {
    FormulaAst::Reference {
        target,
        id: id.into(),
    }
}
fn binary(operator: BinaryOperator, left: FormulaAst, right: FormulaAst) -> FormulaAst {
    FormulaAst::Binary {
        operator,
        left: Box::new(left),
        right: Box::new(right),
    }
}
fn formula(id: &str, ast: FormulaAst) -> Formula {
    Formula {
        id: id.into(),
        name: id.into(),
        scope: FormulaScope::Source,
        expression: "old display text".into(),
        ast,
        format: None,
    }
}
fn column(id: &str, label: &str) -> Column {
    serde_json::from_value(serde_json::json!({"id":id,"label":label})).unwrap()
}
fn model(formulas: Vec<Formula>) -> ValidatedDefinition {
    ValidatedDefinition{analytical_recipe_source:None,locale:"en-US".into(),definition:TableDefinition{table:TableState::default(),search:String::new(),analytical:Some(serde_json::from_value(serde_json::json!({"schemaVersion":1,"enabled":true,"params":{"promotePage":false,"filters":[]},"categories":[],"measures":[],"formulas":formulas,"layout":{"rows":[],"columns":[],"values":[]},"checklists":[],"resultFilters":[],"subtotals":{"grandTotal":true,"groups":true}})).unwrap())}}
}
fn row(values: Vec<(&str, WireValue)>) -> DatasetRow {
    DatasetRow {
        id: "r".into(),
        values: values.into_iter().map(|(k, v)| (k.into(), v)).collect(),
        group_path: None,
        cell_errors: None,
        cell_formats: None,
    }
}
fn n(n: f64) -> WireValue {
    WireValue::F64(WireNumber::Finite(n))
}
fn code(result: &CellResult) -> &str {
    match result {
        CellResult::Error(e) => &e.code,
        _ => panic!("expected error"),
    }
}
#[test]
fn committed_bindings_and_error_distinctions() {
    let compiled = compile(
        &model(vec![
            formula("div", binary(BinaryOperator::Divide, lit(1.), lit(0.))),
            formula(
                "text",
                binary(
                    BinaryOperator::Add,
                    reference(ReferenceTarget::Field, "x"),
                    lit(1.),
                ),
            ),
            formula("missing", reference(ReferenceTarget::Field, "absent")),
            formula("nan-out", reference(ReferenceTarget::Field, "nan")),
        ]),
        &[
            column("x", "Renamed X"),
            column("absent", "Absent"),
            column("nan", "NaN"),
        ],
    );
    let result = evaluate_source(
        &[row(vec![
            ("x", WireValue::String("2".into())),
            (
                "nan",
                WireValue::F64(WireNumber::Special(SpecialNumber::Nan)),
            ),
        ])],
        &compiled,
    );
    let cells = &result.formula_cells["r"];
    assert_eq!(code(&cells["div"]), "division-by-zero");
    assert_eq!(code(&cells["text"]), "invalid-type");
    assert_eq!(code(&cells["missing"]), "missing-input");
    assert_eq!(code(&cells["nan-out"]), "nonfinite");
}
#[test]
fn lazy_if_and_actual_dependencies() {
    let ast = FormulaAst::Call {
        function: FormulaFunction::If,
        args: vec![
            FormulaAst::Literal {
                value: Literal::Bool(true),
            },
            reference(ReferenceTarget::Field, "x"),
            binary(BinaryOperator::Divide, lit(1.), lit(0.)),
        ],
    };
    let compiled = compile(
        &model(vec![
            formula("if", ast),
            formula(
                "bad",
                FormulaAst::Call {
                    function: FormulaFunction::If,
                    args: vec![lit(1.), lit(2.), lit(3.)],
                },
            ),
            formula("dependent", reference(ReferenceTarget::Formula, "bad")),
        ]),
        &[column("x", "X")],
    );
    let result = evaluate_source(&[row(vec![("x", n(7.))])], &compiled);
    assert_eq!(result.formula_cells["r"]["if"], CellResult::Value(n(7.)));
    assert_eq!(result.source_dependencies["r"]["if"].clone(), vec!["x"]);
    assert_eq!(code(&result.formula_cells["r"]["bad"]), "invalid-type");
    assert_eq!(
        code(&result.formula_cells["r"]["dependent"]),
        "blocked-dependency"
    );
}
fn first_cycle(c: &CompiledModel) -> &[String] {
    let d = c
        .graph
        .diagnostics
        .iter()
        .find(|d| d.code == "cycle")
        .unwrap();
    &d.dependency_ids
}
#[test]
fn cycles_and_transitive_blocking() {
    let compiled = compile(
        &model(vec![
            formula("a", reference(ReferenceTarget::Formula, "b")),
            formula("b", reference(ReferenceTarget::Formula, "a")),
            formula("c", reference(ReferenceTarget::Formula, "a")),
            formula("good", lit(3.)),
        ]),
        &[],
    );
    assert_eq!(compiled.graph.order, vec!["good"]);
    assert_eq!(first_cycle(&compiled), vec!["a", "b", "a"]);
    assert_eq!(compiled.graph.blocked_ids, vec!["a", "b", "c"]);
    assert_eq!(
        compiled.graph.diagnostics[0].message,
        "Circular reference: a → b → a."
    );
    let r = evaluate_source(&[row(vec![])], &compiled);
    assert_eq!(code(&r.formula_cells["r"]["a"]), "cycle");
    assert_eq!(code(&r.formula_cells["r"]["c"]), "blocked-dependency");
}
#[test]
fn authoring_names_ambiguity_and_scoped_binding() {
    let compiled = compile(
        &model(vec![]),
        &[column("x", "Revenue"), column("y", "Revenue")],
    );
    let draft = FormulaDraft {
        id: "f".into(),
        name: "F".into(),
        scope: FormulaScope::Source,
        expression: "Revenue + 1".into(),
        format: None,
    };
    assert_eq!(
        bind_formula(&compiled, &draft, &[]).diagnostics[0].code,
        "ambiguous-reference"
    );
    let result = bind_formula(
        &compiled,
        &draft,
        &[ScopedBinding {
            scope: FormulaScope::Source,
            name: "Revenue".into(),
            reference: reference(ReferenceTarget::Field, "y"),
        }],
    );
    assert!(result.diagnostics.is_empty());
    assert!(
        matches!(result.ast,Some(FormulaAst::Binary{left,..}) if matches!(&*left,FormulaAst::Reference{id,..} if id=="y"))
    );
}
#[test]
fn parser_limits_precedence_and_unsafe_syntax() {
    let parsed = parse_formula("-2 + 3 * 4 / 2 >= 1");
    assert!(parsed.diagnostics.is_empty());
    assert!(matches!(
        parsed.ast,
        Some(SyntaxAst::Binary {
            operator: BinaryOperator::GreaterEqual,
            ..
        })
    ));
    for s in ["a.b", "evil(1)", "SUM()", "IF(1,2)", "1e999", "1 2"] {
        assert_eq!(parse_formula(s).diagnostics[0].code, "syntax", "{s}");
    }
    assert!(
        parse_formula(&format!("{}1{}", "(".repeat(256), ")".repeat(256)))
            .diagnostics
            .is_empty()
    );
    assert_eq!(
        parse_formula(&format!("{}1{}", "(".repeat(257), ")".repeat(257))).diagnostics[0].code,
        "parser-nesting-limit"
    );
    assert!(parse_formula(&format!("{}1", "-".repeat(63)))
        .diagnostics
        .is_empty());
    assert_eq!(
        parse_formula(&format!("{}1", "-".repeat(64))).diagnostics[0].code,
        "depth-limit"
    );
    assert!(parse_formula(&format!("\"{}\"", "é".repeat(8191)))
        .diagnostics
        .is_empty());
    assert_eq!(
        parse_formula(&format!("\"{}a\"", "é".repeat(8191))).diagnostics[0].code,
        "expression-limit"
    );
}
#[test]
fn preserves_metadata_deduplicates_and_normalizes_only_count() {
    let mut count = column("x", "X");
    count.aggregation = Some(Aggregation::Count);
    count.metadata = Some(BTreeMap::from([(
        "origin".into(),
        WireValue::String("kept".into()),
    )]));
    let compiled = compile(
        &model(vec![formula(
            "f",
            binary(
                BinaryOperator::Add,
                reference(ReferenceTarget::Field, "x"),
                lit(1.),
            ),
        )]),
        &[count.clone()],
    );
    let mut input = row(vec![("x", WireValue::String("2".into()))]);
    input.cell_formats = Some(BTreeMap::from([(
        "x".into(),
        CellFormat {
            formatter_fn: Some("number".into()),
            decimal_places: Some(0),
            abbreviate: None,
        },
    )]));
    let r = evaluate_source(&[input.clone(), input.clone()], &compiled);
    assert_eq!(r.rows.len(), 1);
    assert_eq!(r.rows[0].values["f"], n(3.));
    assert_eq!(
        r.rows[0].cell_formats.as_ref().unwrap()["x"].decimal_places,
        Some(0)
    );
    assert_eq!(r.columns[0].metadata, count.metadata);
    assert_eq!(input.values.len(), 1);
}
#[test]
fn unicode_identifier_and_ecmascript_whitespace_boundaries() {
    assert_eq!(parse_formula("\u{345}").diagnostics[0].code, "syntax");
    assert_eq!(parse_formula("1\u{85}+2").diagnostics[0].code, "syntax");
    assert!(parse_formula("\u{feff}東京² + 1").diagnostics.is_empty());
    assert!(parse_formula("\u{2007}1 + 2\u{2028}")
        .diagnostics
        .is_empty());
}
#[test]
fn measure_labels_use_baseline_operator_names_and_duplicate_ordinals() {
    let mut definition = model(vec![]);
    definition
        .definition
        .analytical
        .as_mut()
        .unwrap()
        .table_mut()
        .unwrap()
        .measures = vec![
        Measure {
            id: "a".into(),
            source_field_id: "x".into(),
            aggregation: Some(Aggregation::Sum),
            custom_label: None,
        },
        Measure {
            id: "b".into(),
            source_field_id: "x".into(),
            aggregation: Some(Aggregation::Sum),
            custom_label: None,
        },
    ];
    let compiled = compile(&definition, &[column("x", "Revenue")]);
    assert_eq!(compiled.symbols.measures[0].name, "Revenue — Total");
    assert_eq!(compiled.symbols.measures[1].name, "Revenue — Total (2)");
}
#[test]
fn ast_node_byte_depth_and_arity_boundaries() {
    fn tree(leaves: usize) -> String {
        if leaves == 1 {
            "1".into()
        } else {
            format!("({}+{})", tree(leaves / 2), tree(leaves - leaves / 2))
        }
    }
    assert!(parse_formula(&format!("-{}", tree(512)))
        .diagnostics
        .is_empty());
    assert_eq!(parse_formula(&tree(513)).diagnostics[0].code, "node-limit");
    let mut ast = lit(1.);
    for _ in 0..63 {
        ast = FormulaAst::Unary {
            operator: UnaryOperator::Minus,
            operand: Box::new(ast),
        };
    }
    assert!(validate_ast(&ast).is_ok());
    ast = FormulaAst::Unary {
        operator: UnaryOperator::Minus,
        operand: Box::new(ast),
    };
    assert_eq!(validate_ast(&ast).unwrap_err().code, "depth-limit");
    assert_eq!(
        validate_ast(&FormulaAst::Literal {
            value: Literal::String("é".repeat(8193))
        })
        .unwrap_err()
        .code,
        "expression-limit"
    );
    assert_eq!(
        validate_ast(&FormulaAst::Call {
            function: FormulaFunction::If,
            args: vec![lit(1.)]
        })
        .unwrap_err()
        .code,
        "invalid-ast"
    );
}
#[test]
fn source_blanks_input_errors_counts_and_output_collision() {
    let compiled = compile(
        &model(vec![formula(
            "f",
            binary(
                BinaryOperator::Add,
                reference(ReferenceTarget::Field, "x"),
                lit(1.),
            ),
        )]),
        &[column("x", "X")],
    );
    for blank in [
        WireValue::Null,
        WireValue::Missing,
        WireValue::String(String::new()),
        WireValue::Bool(false),
        WireValue::BigIntString("1".into()),
    ] {
        let r = evaluate_source(&[row(vec![("x", blank)])], &compiled);
        assert_eq!(code(&r.formula_cells["r"]["f"]), "invalid-type");
    }
    let r = evaluate_source(&[row(vec![("x", n(1.)), ("f", n(99.))])], &compiled);
    assert_eq!(r.rows[0].values["f"], n(99.));
    assert_eq!(code(&r.formula_cells["r"]["f"]), "ambiguous-reference");
    let mut count = column("x", "X");
    count.aggregation = Some(Aggregation::Count);
    let compiled = compile(&compiled.definition, &[count]);
    for (value, expected) in [
        ("-1", "invalid-type"),
        ("1.5", "invalid-type"),
        ("9007199254740992", "nonfinite"),
    ] {
        let r = evaluate_source(
            &[row(vec![("x", WireValue::String(value.into()))])],
            &compiled,
        );
        assert_eq!(code(&r.formula_cells["r"]["f"]), expected);
    }
    let mut input = row(vec![("x", n(7.))]);
    input.cell_errors = Some(BTreeMap::from([(
        "x".into(),
        CellError {
            code: "origin-failure".into(),
            message: "Incoming failed".into(),
            definition_id: None,
            dependency_ids: Some(vec!["origin".into()]),
            affected_record_count: None,
            record_preview: None,
        },
    )]));
    let r = evaluate_source(&[input], &compiled);
    match &r.formula_cells["r"]["f"] {
        CellResult::Error(e) => {
            assert_eq!(e.code, "blocked-dependency");
            assert_eq!(e.dependency_ids, vec!["x", "origin"]);
            assert_eq!(e.record_ids, vec!["r"]);
        }
        _ => panic!("expected incoming failure"),
    };
    assert!(r.rows[0].cell_errors.as_ref().unwrap().contains_key("x"));
    assert!(r.errors["r"].contains_key("x"));
}
#[test]
fn graph_cross_kind_cycles_scope_refusal_missing_and_ambiguous_ids() {
    let mut a = formula("a", reference(ReferenceTarget::Formula, "b"));
    let mut b = formula(
        "b",
        FormulaAst::Member {
            value: Box::new(lit(1.)),
            selectors: vec![MemberSelector {
                category_id: "category".into(),
                member_key: "one".into(),
            }],
        },
    );
    b.scope = FormulaScope::Aggregate;
    let mut c = formula("c", reference(ReferenceTarget::Measure, "measure"));
    c.scope = FormulaScope::Aggregate;
    let mut definition = model(vec![a.clone(), b, c, formula("okay", lit(1.))]);
    let m = definition
        .definition
        .analytical
        .as_mut()
        .unwrap()
        .table_mut()
        .unwrap();
    m.categories=vec![serde_json::from_value(serde_json::json!({"id":"category","name":"Category","sourceFieldId":"a","transform":"native"})).unwrap()];
    m.measures = vec![Measure {
        id: "measure".into(),
        source_field_id: "a".into(),
        aggregation: Some(Aggregation::Sum),
        custom_label: None,
    }];
    let compiled = compile(&definition, &[]);
    assert_eq!(first_cycle(&compiled), vec!["a", "b", "category", "a"]);
    assert_eq!(compiled.graph.order, vec!["okay"]);
    assert!(compiled
        .graph
        .diagnostics
        .iter()
        .any(|d| d.definition_id.as_deref() == Some("c") && d.code == "blocked-dependency"));
    a.ast = reference(ReferenceTarget::Field, "gone");
    let compiled = compile(
        &model(vec![
            a,
            formula("duplicate", lit(1.)),
            formula("duplicate", lit(2.)),
            formula("consumer", reference(ReferenceTarget::Formula, "duplicate")),
        ]),
        &[],
    );
    assert!(compiled
        .graph
        .diagnostics
        .iter()
        .any(|d| d.code == "missing-reference" && d.dependency_ids == ["gone"]));
    assert!(compiled
        .graph
        .diagnostics
        .iter()
        .any(|d| d.code == "ambiguous-reference" && d.candidate_ids == ["duplicate", "duplicate"]));
    assert!(compiled.graph.order.is_empty());
}
#[test]
fn authoring_retains_committed_ids_across_edits_and_distinguishes_scopes() {
    let mut f = formula(
        "f",
        binary(
            BinaryOperator::Add,
            reference(ReferenceTarget::Field, "x"),
            lit(1.),
        ),
    );
    f.expression = "Revenue + 1".into();
    let compiled = compile(
        &model(vec![f]),
        &[column("x", "Renamed"), column("y", "Revenue")],
    );
    let draft = FormulaDraft {
        id: "f".into(),
        name: "F".into(),
        scope: FormulaScope::Source,
        expression: "Revenue + 2".into(),
        format: None,
    };
    let bound = bind_formula(&compiled, &draft, &[]).ast.unwrap();
    assert!(
        matches!(bound,FormulaAst::Binary{left,..} if matches!(&*left,FormulaAst::Reference{id,..} if id=="x"))
    );
    let mut definition = model(vec![]);
    definition
        .definition
        .analytical
        .as_mut()
        .unwrap()
        .table_mut()
        .unwrap()
        .measures = vec![Measure {
        id: "m".into(),
        source_field_id: "x".into(),
        aggregation: Some(Aggregation::Mean),
        custom_label: None,
    }];
    let compiled = compile(&definition, &[column("x", "Revenue")]);
    let draft = FormulaDraft {
        id: "f".into(),
        name: "F".into(),
        scope: FormulaScope::Aggregate,
        expression: "Revenue + SUM(Revenue)".into(),
        format: None,
    };
    let bound = bind_formula(&compiled, &draft, &[]);
    assert!(bound.diagnostics.is_empty());
    assert!(
        matches!(bound.ast,Some(FormulaAst::Binary{left,right,..}) if matches!(&*left,FormulaAst::Reference{target:ReferenceTarget::Measure,..}) && matches!(&*right,FormulaAst::Call{args,..} if matches!(&args[0],FormulaAst::Reference{target:ReferenceTarget::Field,..})))
    );
    let self_draft = FormulaDraft {
        id: "self".into(),
        name: "Self".into(),
        scope: FormulaScope::Source,
        expression: "Self".into(),
        format: None,
    };
    let bound = bind_formula(&compiled, &self_draft, &[]);
    assert!(bound.ast.is_none());
    assert_eq!(bound.diagnostics[0].code, "cycle");
}
// Structural decoding is test-only. Opaque cells stay tagged and are never fed to a JSON evaluator.
fn get<'a>(v: &'a WireValue, key: &str) -> &'a WireValue {
    if let WireValue::Record(entries) = v {
        entries
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v)
            .unwrap_or(&WireValue::Missing)
    } else {
        panic!("expected record")
    }
}
fn array(v: &WireValue) -> &[WireValue] {
    if let WireValue::Array(v) = v {
        v
    } else {
        panic!("expected array")
    }
}
fn string(v: &WireValue) -> &str {
    if let WireValue::String(v) = v {
        v
    } else {
        panic!("expected string")
    }
}
fn plain(v: &WireValue) -> serde_json::Value {
    match v {
        WireValue::Record(v) => v.iter().map(|(k, v)| (k.clone(), plain(v))).collect(),
        WireValue::Array(v) => v.iter().map(plain).collect(),
        WireValue::String(v) => v.clone().into(),
        WireValue::F64(WireNumber::Finite(v))
            if v.fract() == 0. && v.abs() <= 9007199254740991. =>
        {
            serde_json::json!(*v as i64)
        }
        WireValue::F64(WireNumber::Finite(v)) => serde_json::json!(v),
        WireValue::Bool(v) => (*v).into(),
        WireValue::Null => serde_json::Value::Null,
        _ => panic!("special/absent scalar is not a structural primitive"),
    }
}
#[test]
fn frozen_source_values_errors_and_authoring_refusal_projection() {
    for name in ["authoring-refusal", "pivot-off-source-safe"] {
        let root: WireValue = serde_json::from_str(
            &std::fs::read_to_string(format!("../../src/test/fixtures/rust-pivot/{name}.json"))
                .unwrap(),
        )
        .unwrap();
        let case = get(&root, "case");
        let ds = get(case, "dataset");
        let raw = get(case, "definition");
        let definition = ValidatedDefinition {
            analytical_recipe_source: None,
            locale: "en-US".into(),
            definition: TableDefinition {
                table: TableState::default(),
                search: String::new(),
                analytical: Some(serde_json::from_value(plain(get(raw, "analytical"))).unwrap()),
            },
        };
        let columns = array(get(ds, "columns"))
            .iter()
            .map(|c| serde_json::from_value(plain(c)).unwrap())
            .collect::<Vec<Column>>();
        let rows = array(get(ds, "rows"))
            .iter()
            .map(|r| {
                let WireValue::Record(values) = get(r, "values") else {
                    panic!("expected values")
                };
                DatasetRow {
                    id: string(get(r, "id")).into(),
                    values: values.iter().cloned().collect(),
                    group_path: None,
                    cell_errors: None,
                    cell_formats: None,
                }
            })
            .collect::<Vec<_>>();
        let compiled = compile(&definition, &columns);
        let evaluated = evaluate_source(&rows, &compiled);
        let frozen = get(&root, "result");
        let delivered = array(get(
            get(&array(get(frozen, "deliveries"))[0], "tree"),
            "rows",
        ));
        for expected in delivered {
            let id = string(get(expected, "id"));
            let actual = &evaluated.formula_cells[id];
            for formula in compiled
                .symbols
                .formulas
                .iter()
                .filter(|f| f.scope == FormulaScope::Source)
            {
                match &actual[&formula.id] {
                    CellResult::Value(v) => assert_eq!(
                        v,
                        get(get(expected, "values"), &formula.id),
                        "{name}/{id}/{}",
                        formula.id
                    ),
                    CellResult::Error(e) => {
                        let saved = get(get(expected, "cellErrors"), &formula.id);
                        assert_eq!(e.code, string(get(saved, "code")));
                        assert_eq!(e.message, string(get(saved, "message")));
                        assert_eq!(e.definition_id, string(get(saved, "definitionId")));
                        assert_eq!(
                            e.record_ids.iter().map(String::as_str).collect::<Vec<_>>(),
                            array(get(saved, "recordPreview"))
                                .iter()
                                .map(string)
                                .collect::<Vec<_>>()
                        );
                    }
                }
            }
        }
        if name == "authoring-refusal" {
            for (request, expected) in array(get(case, "operations"))
                .iter()
                .zip(array(get(frozen, "operations")))
            {
                let d = get(request, "draft");
                let draft = FormulaDraft {
                    id: string(get(d, "id")).into(),
                    name: string(get(d, "name")).into(),
                    scope: FormulaScope::Aggregate,
                    expression: string(get(d, "expression")).into(),
                    format: None,
                };
                let bindings = array(get(request, "bindings"))
                    .iter()
                    .map(|b| ScopedBinding {
                        scope: FormulaScope::Source,
                        name: string(get(b, "name")).into(),
                        reference: serde_json::from_value(plain(get(b, "reference"))).unwrap(),
                    })
                    .collect::<Vec<_>>();
                let bound = bind_formula(&compiled, &draft, &bindings);
                assert!(bound.ast.is_none());
                let saved = array(get(get(expected, "value"), "bindingDiagnostics"));
                assert_eq!(bound.diagnostics.len(), saved.len());
                for (d, s) in bound.diagnostics.iter().zip(saved) {
                    assert_eq!(d.code, string(get(s, "code")));
                    assert_eq!(d.message, string(get(s, "message")));
                    if let WireValue::Array(ids) = get(s, "dependencyIds") {
                        assert_eq!(
                            d.dependency_ids
                                .iter()
                                .map(String::as_str)
                                .collect::<Vec<_>>(),
                            ids.iter().map(string).collect::<Vec<_>>()
                        );
                    }
                }
            }
        }
    }
}
#[test]
fn authoring_refuses_serialized_ast_budget_after_explicit_binding() {
    fn tree(leaves: usize) -> String {
        if leaves == 1 {
            "X".into()
        } else {
            format!("({}+{})", tree(leaves / 2), tree(leaves - leaves / 2))
        }
    }
    let field = "\u{1}".repeat(32);
    let compiled = compile(&model(vec![]), &[column(&field, "X")]);
    let draft = FormulaDraft {
        id: "f".into(),
        name: "F".into(),
        scope: FormulaScope::Source,
        expression: tree(511),
        format: None,
    };
    let result = bind_formula(
        &compiled,
        &draft,
        &[ScopedBinding {
            scope: FormulaScope::Source,
            name: "X".into(),
            reference: reference(ReferenceTarget::Field, &field),
        }],
    );
    assert!(result.ast.is_none());
    assert!(result.diagnostics.iter().any(|d| d.code == "node-limit"
        && d.message == "Bound formula exceeds the authoring AST budget."));
}
#[test]
fn source_dependency_evidence_preserves_visit_order_for_provenance() {
    let ast = binary(
        BinaryOperator::Add,
        reference(ReferenceTarget::Field, "z"),
        binary(
            BinaryOperator::Add,
            reference(ReferenceTarget::Field, "a"),
            reference(ReferenceTarget::Field, "z"),
        ),
    );
    let compiled = compile(
        &model(vec![formula("f", ast)]),
        &[column("a", "A"), column("z", "Z")],
    );
    let r = evaluate_source(&[row(vec![("a", n(1.)), ("z", n(2.))])], &compiled);
    assert_eq!(
        r.source_dependencies["r"]["f"]
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        vec!["z", "a"]
    );
}
#[test]
fn authoring_function_whitelist_is_uppercase_only() {
    for name in [
        "SUM",
        "MIN",
        "MAX",
        "MEAN",
        "MEDIAN",
        "COUNT",
        "UNIQUECOUNT",
        "FIRST",
        "LAST",
    ] {
        assert!(
            parse_formula(&format!("{name}(x)")).diagnostics.is_empty(),
            "{name}"
        );
    }
    for name in [
        "sum",
        "min",
        "max",
        "mean",
        "median",
        "count",
        "uniqueCount",
        "first",
        "last",
        "Sum",
        "UniqueCount",
        "if",
    ] {
        let parsed = parse_formula(&format!("{name}(x)"));
        assert!(parsed.ast.is_none(), "{name}");
        assert_eq!(parsed.diagnostics[0].code, "syntax");
        assert_eq!(parsed.diagnostics[0].message, "Unknown formula function.");
        assert_eq!(
            parsed.diagnostics[0].position,
            Some(name.encode_utf16().count())
        );
    }
}
#[test]
fn empty_calls_report_position_after_consuming_closing_parenthesis() {
    for (text, position) in [
        ("MIN()", 5),
        ("IF()", 4),
        ("MIN(  )", 7),
        ("\"𐀀\" + MIN()", 12),
    ] {
        let parsed = parse_formula(text);
        assert!(parsed.ast.is_none());
        assert_eq!(parsed.diagnostics[0].code, "syntax");
        assert_eq!(
            parsed.diagnostics[0].message,
            "Invalid function argument count."
        );
        assert_eq!(parsed.diagnostics[0].position, Some(position), "{text}");
    }
}
#[test]
fn ambiguous_measure_suggestions_quote_canonical_tokens() {
    for (name, token) in [
        ("a-b", "[a-b]"),
        ("true", "[true]"),
        ("false", "[false]"),
        ("null", "[null]"),
        ("Revenue", "Revenue"),
        ("東京²", "東京²"),
        ("Net Revenue", "[Net Revenue]"),
    ] {
        let mut definition = model(vec![]);
        definition
            .definition
            .analytical
            .as_mut()
            .unwrap()
            .table_mut()
            .unwrap()
            .measures = vec![
            Measure {
                id: "m1".into(),
                source_field_id: "x".into(),
                aggregation: Some(Aggregation::Sum),
                custom_label: None,
            },
            Measure {
                id: "m2".into(),
                source_field_id: "x".into(),
                aggregation: Some(Aggregation::Mean),
                custom_label: None,
            },
        ];
        let compiled = compile(&definition, &[column("x", name)]);
        let expression = if name == "Revenue" || name == "東京²" {
            name.into()
        } else {
            format!("[{name}]")
        };
        let result = bind_formula(
            &compiled,
            &FormulaDraft {
                id: "f".into(),
                name: "F".into(),
                scope: FormulaScope::Aggregate,
                expression,
                format: None,
            },
            &[],
        );
        assert!(result.ast.is_none());
        assert_eq!(result.diagnostics.len(), 1);
        let diagnostic = &result.diagnostics[0];
        assert_eq!(diagnostic.code, "ambiguous-reference");
        assert_eq!(
            diagnostic.message,
            format!(
                "{name} has more than one measure; use an explicit function such as SUM({token})"
            )
        );
        assert_eq!(diagnostic.candidate_ids, vec!["m1", "m2"]);
    }
}
#[test]
fn escaped_utf16_surrogates_refuse_lone_units_and_preserve_pairs() {
    for text in [r#""\ud800""#, r#""\udfff""#, r#""x\uD800x""#] {
        let parsed = parse_formula(text);
        assert!(parsed.ast.is_none());
        assert_eq!(parsed.diagnostics[0].code, "invalid-ast");
        assert_eq!(parsed.diagnostics[0].message,"Unsupported string encoding: protocol version 1 requires Unicode scalar strings; unpaired UTF-16 surrogates are not supported.");
        assert_eq!(
            parsed.diagnostics[0].position,
            Some(text.encode_utf16().count())
        );
    }
    let parsed = parse_formula(r#""\ud800\udc00""#);
    assert!(parsed.diagnostics.is_empty());
    assert!(
        matches!(parsed.ast,Some(SyntaxAst::Literal{value:Literal::String(value)}) if value=="𐀀")
    );
    assert!(parse_formula(r#""\\ud800""#).diagnostics.is_empty());
    assert_eq!(
        parse_formula(r#""\ud80g""#).diagnostics[0].message,
        "Invalid quoted literal."
    );
}
#[test]
fn fiscal_quarter_binds_by_displayed_label_and_stored_value() {
    // Author ruling 2026-10-16: headers read FY2025-Q1; saved formulas keep FY2025 Q1.
    let compiled_with = |transform: &str| {
        let mut definition = model(vec![]);
        let analytical = definition.definition.analytical.as_mut().unwrap();
        *analytical = serde_json::from_value(serde_json::json!({"schemaVersion":1,"enabled":true,"params":{"promotePage":false,"filters":[]},"categories":[{"id":"fq","name":"Quarter","sourceFieldId":"date","transform":transform}],"measures":[{"id":"rev","sourceFieldId":"revenue","aggregation":"sum"}],"formulas":[],"layout":{"rows":[],"columns":[],"values":[]},"checklists":[],"resultFilters":[],"subtotals":{"grandTotal":true,"groups":true}})).unwrap();
        let mut compiled = compile(
            &definition,
            &[column("date", "Date"), column("revenue", "Revenue")],
        );
        compiled.symbols.categories[0].members =
            vec![("q1".into(), Literal::String("FY2025 Q1".into()))];
        compiled
    };
    let draft = |expression: &str| FormulaDraft {
        id: "f".into(),
        name: "F".into(),
        scope: FormulaScope::Aggregate,
        expression: expression.into(),
        format: None,
    };
    let fq = compiled_with("FQ");
    for text in [
        r#"Revenue[Quarter="FY2025-Q1"]"#,
        r#"Revenue[Quarter="FY2025 Q1"]"#,
    ] {
        let result = bind_formula(&fq, &draft(text), &[]);
        assert!(
            result.diagnostics.is_empty(),
            "{text}: {:?}",
            result.diagnostics
        );
        assert!(
            matches!(&result.ast, Some(FormulaAst::Member { selectors, .. }) if selectors[0].member_key == "q1"),
            "{text}"
        );
    }
    assert_eq!(
        bind_formula(&fq, &draft(r#"Revenue[Quarter="FY2025-Q2"]"#), &[]).diagnostics[0].code,
        "missing-member"
    );
    // Only a fiscal quarter reads the label: a native category keeps its text as typed.
    let native = compiled_with("native");
    assert_eq!(
        bind_formula(&native, &draft(r#"Revenue[Quarter="FY2025-Q1"]"#), &[]).diagnostics[0].code,
        "missing-member"
    );
}
#[test]
fn unquoted_number_binds_a_bucketed_category_string_member() {
    // TS parity (e7bc077d): a Y/Q/M bucket's members are strings, but people type Revenue[Year=2024].
    let compiled_with = |transform: &str| {
        let mut definition = model(vec![]);
        let analytical = definition.definition.analytical.as_mut().unwrap();
        *analytical = serde_json::from_value(serde_json::json!({"schemaVersion":1,"enabled":true,"params":{"promotePage":false,"filters":[]},"categories":[{"id":"year","name":"Year","sourceFieldId":"date","transform":transform}],"measures":[{"id":"rev","sourceFieldId":"revenue","aggregation":"sum"}],"formulas":[],"layout":{"rows":[],"columns":[],"values":[]},"checklists":[],"resultFilters":[],"subtotals":{"grandTotal":true,"groups":true}})).unwrap();
        let mut compiled = compile(
            &definition,
            &[column("date", "Date"), column("revenue", "Revenue")],
        );
        compiled.symbols.categories[0].members =
            vec![("y2024".into(), Literal::String("2024".into()))];
        compiled
    };
    let draft = |expression: &str| FormulaDraft {
        id: "f".into(),
        name: "F".into(),
        scope: FormulaScope::Aggregate,
        expression: expression.into(),
        format: None,
    };
    let y = compiled_with("Y");
    for text in ["Revenue[Year=2024]", r#"Revenue[Year="2024"]"#] {
        let result = bind_formula(&y, &draft(text), &[]);
        assert!(
            result.diagnostics.is_empty(),
            "{text}: {:?}",
            result.diagnostics
        );
        assert!(
            matches!(&result.ast, Some(FormulaAst::Member { selectors, .. }) if selectors[0].member_key == "y2024"),
            "{text}"
        );
    }
    // A native category keeps 1 and "1" distinct.
    let native = compiled_with("native");
    assert_eq!(
        bind_formula(&native, &draft("Revenue[Year=2024]"), &[]).diagnostics[0].code,
        "missing-member"
    );
}

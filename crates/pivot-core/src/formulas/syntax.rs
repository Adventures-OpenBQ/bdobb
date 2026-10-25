// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Full diagnostic evidence is intentionally returned by value.
#![allow(clippy::result_large_err)]
use super::*;
const BYTES: usize = 16384;
fn limit(code: &str, message: &str) -> FormulaDiagnostic {
    FormulaDiagnostic::new(code, message)
}
fn bounded(ast: &SyntaxAst) -> Result<(), FormulaDiagnostic> {
    let mut stack = vec![(ast, 1)];
    let mut nodes = 0;
    let mut bytes = 0;
    while let Some((ast, depth)) = stack.pop() {
        if depth > 64 {
            return Err(limit(
                "depth-limit",
                "Formula exceeds the AST depth limit of 64.",
            ));
        }
        nodes += 1;
        if nodes > 1024 {
            return Err(limit(
                "node-limit",
                "Formula exceeds the AST node limit of 1,024.",
            ));
        }
        match ast {
            SyntaxAst::Literal {
                value: Literal::Number(n),
            } if !n.is_finite() => {
                return Err(limit("invalid-ast", "Invalid formula AST structure."))
            }
            SyntaxAst::Literal {
                value: Literal::String(s),
            } => bytes += s.len(),
            SyntaxAst::Name { name } => {
                if name.is_empty() {
                    return Err(limit("invalid-ast", "Invalid formula AST structure."));
                }
                bytes += name.len()
            }
            SyntaxAst::Reference { id, .. } => {
                if id.is_empty() {
                    return Err(limit("invalid-ast", "Invalid formula AST structure."));
                }
                bytes += id.len()
            }
            SyntaxAst::Unary { operand, .. } => stack.push((operand, depth + 1)),
            SyntaxAst::Binary { left, right, .. } => {
                stack.push((right, depth + 1));
                stack.push((left, depth + 1));
            }
            SyntaxAst::Call { function, args } => {
                if args.len() > 1024 {
                    return Err(limit(
                        "node-limit",
                        "Formula exceeds the AST node limit of 1,024.",
                    ));
                }
                if args.len()
                    != if *function == FormulaFunction::If {
                        3
                    } else {
                        1
                    }
                {
                    return Err(limit("invalid-ast", "Invalid formula AST structure."));
                }
                for a in args.iter().rev() {
                    stack.push((a, depth + 1));
                }
            }
            SyntaxAst::Member { value, selectors } => {
                if selectors.len() > 1024 {
                    return Err(limit(
                        "node-limit",
                        "Formula exceeds the AST node limit of 1,024.",
                    ));
                }
                if selectors.is_empty() {
                    return Err(limit("invalid-ast", "Invalid formula AST structure."));
                }
                stack.push((value, depth + 1));
                for s in selectors {
                    match s {
                        SyntaxSelector::Bound(s) => {
                            if s.category_id.is_empty() || s.member_key.is_empty() {
                                return Err(limit("invalid-ast", "Invalid formula AST structure."));
                            }
                            bytes += s.category_id.len() + s.member_key.len()
                        }
                        SyntaxSelector::Named {
                            category_name,
                            value,
                        } => {
                            bytes += category_name.len();
                            if let Literal::String(s) = value {
                                bytes += s.len();
                            }
                        }
                    }
                }
            }
            _ => (),
        }
        if bytes > BYTES {
            return Err(limit(
                "expression-limit",
                "Formula exceeds the 16 KiB UTF-8 expression limit.",
            ));
        }
    }
    Ok(())
}
pub fn validate_ast(ast: &FormulaAst) -> Result<(), FormulaDiagnostic> {
    // Refuse unbounded typed inputs before recursive copying into the syntax tree.
    let mut pending = vec![(ast, 1)];
    let mut nodes = 0;
    while let Some((ast, depth)) = pending.pop() {
        if depth > 64 {
            return Err(limit(
                "depth-limit",
                "Formula exceeds the AST depth limit of 64.",
            ));
        }
        nodes += 1;
        if nodes > 1024 {
            return Err(limit(
                "node-limit",
                "Formula exceeds the AST node limit of 1,024.",
            ));
        }
        match ast {
            FormulaAst::Unary { operand, .. } => pending.push((operand, depth + 1)),
            FormulaAst::Binary { left, right, .. } => {
                pending.push((right, depth + 1));
                pending.push((left, depth + 1));
            }
            FormulaAst::Call { args, .. } => {
                for arg in args.iter().rev() {
                    pending.push((arg, depth + 1));
                }
            }
            FormulaAst::Member { value, .. } => pending.push((value, depth + 1)),
            _ => (),
        }
    }
    bounded(&from_bound(ast))
}
pub(crate) fn from_bound(ast: &FormulaAst) -> SyntaxAst {
    match ast {
        FormulaAst::Literal { value } => SyntaxAst::Literal {
            value: value.clone(),
        },
        FormulaAst::Reference { target, id } => SyntaxAst::Reference {
            target: *target,
            id: id.clone(),
        },
        FormulaAst::Unary { operator, operand } => SyntaxAst::Unary {
            operator: *operator,
            operand: Box::new(from_bound(operand)),
        },
        FormulaAst::Binary {
            operator,
            left,
            right,
        } => SyntaxAst::Binary {
            operator: *operator,
            left: Box::new(from_bound(left)),
            right: Box::new(from_bound(right)),
        },
        FormulaAst::Call { function, args } => SyntaxAst::Call {
            function: *function,
            args: args.iter().map(from_bound).collect(),
        },
        FormulaAst::Member { value, selectors } => SyntaxAst::Member {
            value: Box::new(from_bound(value)),
            selectors: selectors
                .iter()
                .cloned()
                .map(SyntaxSelector::Bound)
                .collect(),
        },
    }
}
struct Parser<'a> {
    text: &'a str,
    position: usize,
    nodes: usize,
}
impl Parser<'_> {
    fn ws(&mut self) {
        while let Some(c) = self.text[self.position..].chars().next() {
            if !ecmascript_whitespace(c) {
                break;
            }
            self.position += c.len_utf8();
        }
    }
    fn peek(&mut self) -> Option<char> {
        self.ws();
        self.text[self.position..].chars().next()
    }
    fn error(&self, message: &str) -> FormulaDiagnostic {
        let mut d = limit("syntax", message);
        d.position = Some(
            self.text[..self.position.min(self.text.len())]
                .encode_utf16()
                .count(),
        );
        d
    }
    fn consume(&mut self, token: &str) -> Result<(), FormulaDiagnostic> {
        self.ws();
        if !self.text[self.position..].starts_with(token) {
            return Err(self.error(&format!("Expected {token}.")));
        }
        self.position += token.len();
        Ok(())
    }
    fn node(&mut self, ast: SyntaxAst) -> Result<SyntaxAst, FormulaDiagnostic> {
        self.nodes += 1;
        if self.nodes > 1024 {
            return Err(limit(
                "node-limit",
                "Formula exceeds the AST node limit of 1,024.",
            ));
        }
        Ok(ast)
    }
    fn name(&mut self) -> Result<String, FormulaDiagnostic> {
        self.ws();
        if self.text[self.position..].starts_with('[') {
            self.position += 1;
            let start = self.position;
            let Some(end) = self.text[start..].find(']') else {
                return Err(self.error("Expected a bracketed identifier."));
            };
            if end == 0 {
                return Err(self.error("Expected a bracketed identifier."));
            }
            self.position += end + 1;
            return Ok(self.text[start..start + end].into());
        }
        let start = self.position;
        for (i, c) in self.text[start..].char_indices() {
            if if i == 0 {
                c == '_' || unicode_category(c, LETTERS)
            } else {
                c == '_' || unicode_category(c, NUMBERS) || unicode_category(c, LETTERS)
            } {
                self.position = start + i + c.len_utf8();
            } else {
                break;
            }
        }
        if start == self.position {
            Err(self.error("Expected an identifier."))
        } else {
            Ok(self.text[start..self.position].into())
        }
    }
    fn scalar(&mut self) -> Result<Literal, FormulaDiagnostic> {
        self.ws();
        if self.peek() == Some('"') {
            let start = self.position;
            self.position += 1;
            while self.position < self.text.len() {
                let c = self.text[self.position..].chars().next().unwrap();
                self.position += c.len_utf8();
                if c == '\\' {
                    if let Some(c) = self.text[self.position..].chars().next() {
                        self.position += c.len_utf8();
                    }
                    continue;
                }
                if c == '"' {
                    return serde_json::from_str::<String>(&self.text[start..self.position])
                        .map(Literal::String)
                        .map_err(|_| {
                            if has_unpaired_surrogate(&self.text[start..self.position]) {
                                let mut diagnostic = self.error("Unsupported string encoding: protocol version 1 requires Unicode scalar strings; unpaired UTF-16 surrogates are not supported.");
                                diagnostic.code = "invalid-ast".into();
                                diagnostic
                            } else { self.error("Invalid quoted literal.") }
                        });
                }
            }
            return Err(self.error("Unterminated quoted literal."));
        }
        let start = self.position;
        let b = self.text.as_bytes();
        let mut p = start;
        if b.get(p) == Some(&b'-') {
            p += 1;
        }
        let before = p;
        while b.get(p).is_some_and(u8::is_ascii_digit) {
            p += 1;
        }
        let mut digits = p > before;
        if b.get(p) == Some(&b'.') {
            p += 1;
            let begin = p;
            while b.get(p).is_some_and(u8::is_ascii_digit) {
                p += 1;
            }
            digits |= p > begin;
        }
        if digits {
            if matches!(b.get(p), Some(b'e' | b'E')) {
                let exponent = p;
                p += 1;
                if matches!(b.get(p), Some(b'+' | b'-')) {
                    p += 1;
                }
                let begin = p;
                while b.get(p).is_some_and(u8::is_ascii_digit) {
                    p += 1;
                }
                if begin == p {
                    p = exponent;
                }
            }
            self.position = p;
            let value = self.text[start..p]
                .parse::<f64>()
                .map_err(|_| self.error("Expected a finite numeric literal."))?;
            if !value.is_finite() {
                return Err(self.error("Expected a finite numeric literal."));
            }
            return Ok(Literal::Number(value));
        }
        let name = self.name()?;
        Ok(match name.as_str() {
            "true" => Literal::Bool(true),
            "false" => Literal::Bool(false),
            "null" => Literal::Null,
            _ => Literal::String(name),
        })
    }
    fn expression(&mut self, minimum: u8, nesting: usize) -> Result<SyntaxAst, FormulaDiagnostic> {
        enum Work {
            Eval(u8, usize),
            Finish(u8, usize),
            Loop(u8, usize),
            Unary(UnaryOperator),
            Paren,
            Binary(BinaryOperator, SyntaxAst, u8, usize),
            Call(FormulaFunction, Vec<SyntaxAst>, usize),
        }
        let mut work = vec![Work::Eval(minimum, nesting)];
        let mut values = vec![];
        while let Some(task) = work.pop() {
            match task {
                Work::Eval(minimum, nesting) => {
                    if nesting > 256 {
                        return Err(limit(
                            "parser-nesting-limit",
                            "Formula exceeds the parser nesting limit of 256.",
                        ));
                    }
                    work.push(Work::Finish(minimum, nesting));
                    let token = self.peek();
                    match token {
                        Some('+' | '-') => {
                            self.position += 1;
                            work.push(Work::Unary(if token == Some('-') {
                                UnaryOperator::Minus
                            } else {
                                UnaryOperator::Plus
                            }));
                            work.push(Work::Eval(4, nesting + 1));
                        }
                        Some('(') => {
                            self.position += 1;
                            work.push(Work::Paren);
                            work.push(Work::Eval(0, nesting + 1));
                        }
                        Some('"' | '.' | '0'..='9') => {
                            let value = self.scalar()?;
                            values.push(self.node(SyntaxAst::Literal { value })?);
                        }
                        _ => {
                            let bracketed = token == Some('[');
                            let name = self.name()?;
                            if !bracketed && self.peek() == Some('(') {
                                let function = match name.as_str() {
                                    "SUM" => FormulaFunction::Sum,
                                    "MIN" => FormulaFunction::Min,
                                    "MAX" => FormulaFunction::Max,
                                    "MEAN" => FormulaFunction::Mean,
                                    "MEDIAN" => FormulaFunction::Median,
                                    "COUNT" => FormulaFunction::Count,
                                    "UNIQUECOUNT" => FormulaFunction::UniqueCount,
                                    "FIRST" => FormulaFunction::First,
                                    "LAST" => FormulaFunction::Last,
                                    "IF" => FormulaFunction::If,
                                    _ => return Err(self.error("Unknown formula function.")),
                                };
                                self.position += 1;
                                if self.peek() == Some(')') {
                                    self.consume(")")?;
                                    return Err(self.error("Invalid function argument count."));
                                }
                                work.push(Work::Call(function, vec![], nesting));
                                work.push(Work::Eval(0, nesting + 1));
                            } else if !bracketed
                                && ["true", "false", "null"].contains(&name.as_str())
                            {
                                values.push(self.node(SyntaxAst::Literal {
                                    value: if name == "null" {
                                        Literal::Null
                                    } else {
                                        Literal::Bool(name == "true")
                                    },
                                })?);
                            } else {
                                values.push(self.node(SyntaxAst::Name { name })?);
                            }
                        }
                    }
                }
                Work::Unary(operator) => {
                    let operand = values.pop().unwrap();
                    values.push(self.node(SyntaxAst::Unary {
                        operator,
                        operand: Box::new(operand),
                    })?);
                }
                Work::Paren => self.consume(")")?,
                Work::Call(function, mut args, nesting) => {
                    args.push(values.pop().unwrap());
                    if self.peek() == Some(',') {
                        self.position += 1;
                        work.push(Work::Call(function, args, nesting));
                        work.push(Work::Eval(0, nesting + 1));
                    } else {
                        self.consume(")")?;
                        if args.len()
                            != if function == FormulaFunction::If {
                                3
                            } else {
                                1
                            }
                        {
                            return Err(self.error("Invalid function argument count."));
                        }
                        values.push(self.node(SyntaxAst::Call { function, args })?);
                    }
                }
                Work::Finish(minimum, nesting) => {
                    if self.peek() == Some('[') {
                        let mut selectors = vec![];
                        while self.peek() == Some('[') {
                            self.position += 1;
                            let category_name = self.name()?;
                            self.consume("=")?;
                            let value = self.scalar()?;
                            self.consume("]")?;
                            selectors.push(SyntaxSelector::Named {
                                category_name,
                                value,
                            });
                        }
                        let left = values.pop().unwrap();
                        values.push(self.node(SyntaxAst::Member {
                            value: Box::new(left),
                            selectors,
                        })?);
                    }
                    work.push(Work::Loop(minimum, nesting));
                }
                Work::Loop(minimum, nesting) => {
                    self.ws();
                    let rest = &self.text[self.position..];
                    let found = [
                        ("!=", BinaryOperator::NotEqual, 1),
                        ("<=", BinaryOperator::LessEqual, 1),
                        (">=", BinaryOperator::GreaterEqual, 1),
                        ("=", BinaryOperator::Equal, 1),
                        ("<", BinaryOperator::Less, 1),
                        (">", BinaryOperator::Greater, 1),
                        ("+", BinaryOperator::Add, 2),
                        ("-", BinaryOperator::Subtract, 2),
                        ("*", BinaryOperator::Multiply, 3),
                        ("/", BinaryOperator::Divide, 3),
                    ]
                    .into_iter()
                    .find(|(s, _, p)| rest.starts_with(s) && *p >= minimum);
                    if let Some((token, operator, precedence)) = found {
                        self.position += token.len();
                        work.push(Work::Binary(
                            operator,
                            values.pop().unwrap(),
                            minimum,
                            nesting,
                        ));
                        work.push(Work::Eval(precedence + 1, nesting + 1));
                    }
                }
                Work::Binary(operator, left, minimum, nesting) => {
                    let right = values.pop().unwrap();
                    values.push(self.node(SyntaxAst::Binary {
                        operator,
                        left: Box::new(left),
                        right: Box::new(right),
                    })?);
                    work.push(Work::Loop(minimum, nesting));
                }
            }
        }
        Ok(values.pop().unwrap())
    }
}
pub fn parse_formula(text: &str) -> ParseResult {
    let result = (|| {
        if text.len() > BYTES {
            return Err(limit(
                "expression-limit",
                "Formula exceeds the 16 KiB UTF-8 expression limit.",
            ));
        }
        let mut parser = Parser {
            text,
            position: 0,
            nodes: 0,
        };
        let ast = parser.expression(0, 0)?;
        parser.ws();
        if parser.position != text.len() {
            return Err(parser.error("Unexpected formula syntax."));
        }
        bounded(&ast)?;
        Ok(ast)
    })();
    match result {
        Ok(ast) => ParseResult {
            ast: Some(ast),
            diagnostics: vec![],
        },
        Err(d) => ParseResult {
            ast: None,
            diagnostics: vec![d],
        },
    }
}

pub(crate) fn ecmascript_whitespace(c: char) -> bool {
    matches!(c, '\u{9}'..='\u{d}'|'\u{20}'|'\u{a0}'|'\u{1680}'|'\u{2000}'..='\u{200a}'|'\u{2028}'|'\u{2029}'|'\u{202f}'|'\u{205f}'|'\u{3000}'|'\u{feff}')
}
fn unicode_category(c: char, ranges: &[(u32, u32)]) -> bool {
    let c = c as u32;
    ranges
        .binary_search_by(|&(start, end)| {
            if c < start {
                std::cmp::Ordering::Greater
            } else if c > end {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Equal
            }
        })
        .is_ok()
}

pub(crate) fn ambiguity_operand(name: &str) -> String {
    if name.contains(']') {
        // Match the baseline diagnostic fallback when nameToken cannot represent
        // the imported label. This is diagnostic text, not an insertion token.
        return if name.contains(' ') {
            format!("[{name}]")
        } else {
            name.into()
        };
    }
    let plain = !matches!(name, "true" | "false" | "null")
        && !name.is_empty()
        && name.chars().enumerate().all(|(index, c)| {
            c == '_' || unicode_category(c, LETTERS) || index > 0 && unicode_category(c, NUMBERS)
        });
    if plain {
        name.into()
    } else {
        format!("[{name}]")
    }
}

// Scan only rejected quoted JSON literals; valid paired escapes decode through serde.
// Escaped backslashes are skipped, so "\\ud800" stays ordinary scalar text.
fn has_unpaired_surrogate(quoted: &str) -> bool {
    fn unit(bytes: &[u8], index: usize) -> Option<u16> {
        if bytes.get(index..index + 2)? != b"\\u" {
            return None;
        }
        let hex = std::str::from_utf8(bytes.get(index + 2..index + 6)?).ok()?;
        u16::from_str_radix(hex, 16).ok()
    }
    let bytes = quoted.as_bytes();
    let mut index = 1;
    while index + 1 < bytes.len() {
        if bytes[index] != b'\\' {
            index += 1;
            continue;
        }
        if let Some(value) = unit(bytes, index) {
            if (0xd800..=0xdbff).contains(&value) {
                if unit(bytes, index + 6).is_some_and(|next| (0xdc00..=0xdfff).contains(&next)) {
                    index += 12;
                    continue;
                }
                return true;
            }
            if (0xdc00..=0xdfff).contains(&value) {
                return true;
            }
            index += 6;
        } else {
            index += 2;
        }
    }
    false
}

// Unicode 17.0 general-category ranges captured from baseline Node v26.10.0.
// Reproduce explicitly with scripts/generate-formula-unicode.mjs; never regenerated by builds/tests.
// Names use exactly \p{L} initially and \p{L} / \p{N} thereafter; bracket names are unrestricted.
const LETTERS: &[(u32, u32)] = &[
    (0x41, 0x5a),
    (0x61, 0x7a),
    (0xaa, 0xaa),
    (0xb5, 0xb5),
    (0xba, 0xba),
    (0xc0, 0xd6),
    (0xd8, 0xf6),
    (0xf8, 0x2c1),
    (0x2c6, 0x2d1),
    (0x2e0, 0x2e4),
    (0x2ec, 0x2ec),
    (0x2ee, 0x2ee),
    (0x370, 0x374),
    (0x376, 0x377),
    (0x37a, 0x37d),
    (0x37f, 0x37f),
    (0x386, 0x386),
    (0x388, 0x38a),
    (0x38c, 0x38c),
    (0x38e, 0x3a1),
    (0x3a3, 0x3f5),
    (0x3f7, 0x481),
    (0x48a, 0x52f),
    (0x531, 0x556),
    (0x559, 0x559),
    (0x560, 0x588),
    (0x5d0, 0x5ea),
    (0x5ef, 0x5f2),
    (0x620, 0x64a),
    (0x66e, 0x66f),
    (0x671, 0x6d3),
    (0x6d5, 0x6d5),
    (0x6e5, 0x6e6),
    (0x6ee, 0x6ef),
    (0x6fa, 0x6fc),
    (0x6ff, 0x6ff),
    (0x710, 0x710),
    (0x712, 0x72f),
    (0x74d, 0x7a5),
    (0x7b1, 0x7b1),
    (0x7ca, 0x7ea),
    (0x7f4, 0x7f5),
    (0x7fa, 0x7fa),
    (0x800, 0x815),
    (0x81a, 0x81a),
    (0x824, 0x824),
    (0x828, 0x828),
    (0x840, 0x858),
    (0x860, 0x86a),
    (0x870, 0x887),
    (0x889, 0x88f),
    (0x8a0, 0x8c9),
    (0x904, 0x939),
    (0x93d, 0x93d),
    (0x950, 0x950),
    (0x958, 0x961),
    (0x971, 0x980),
    (0x985, 0x98c),
    (0x98f, 0x990),
    (0x993, 0x9a8),
    (0x9aa, 0x9b0),
    (0x9b2, 0x9b2),
    (0x9b6, 0x9b9),
    (0x9bd, 0x9bd),
    (0x9ce, 0x9ce),
    (0x9dc, 0x9dd),
    (0x9df, 0x9e1),
    (0x9f0, 0x9f1),
    (0x9fc, 0x9fc),
    (0xa05, 0xa0a),
    (0xa0f, 0xa10),
    (0xa13, 0xa28),
    (0xa2a, 0xa30),
    (0xa32, 0xa33),
    (0xa35, 0xa36),
    (0xa38, 0xa39),
    (0xa59, 0xa5c),
    (0xa5e, 0xa5e),
    (0xa72, 0xa74),
    (0xa85, 0xa8d),
    (0xa8f, 0xa91),
    (0xa93, 0xaa8),
    (0xaaa, 0xab0),
    (0xab2, 0xab3),
    (0xab5, 0xab9),
    (0xabd, 0xabd),
    (0xad0, 0xad0),
    (0xae0, 0xae1),
    (0xaf9, 0xaf9),
    (0xb05, 0xb0c),
    (0xb0f, 0xb10),
    (0xb13, 0xb28),
    (0xb2a, 0xb30),
    (0xb32, 0xb33),
    (0xb35, 0xb39),
    (0xb3d, 0xb3d),
    (0xb5c, 0xb5d),
    (0xb5f, 0xb61),
    (0xb71, 0xb71),
    (0xb83, 0xb83),
    (0xb85, 0xb8a),
    (0xb8e, 0xb90),
    (0xb92, 0xb95),
    (0xb99, 0xb9a),
    (0xb9c, 0xb9c),
    (0xb9e, 0xb9f),
    (0xba3, 0xba4),
    (0xba8, 0xbaa),
    (0xbae, 0xbb9),
    (0xbd0, 0xbd0),
    (0xc05, 0xc0c),
    (0xc0e, 0xc10),
    (0xc12, 0xc28),
    (0xc2a, 0xc39),
    (0xc3d, 0xc3d),
    (0xc58, 0xc5a),
    (0xc5c, 0xc5d),
    (0xc60, 0xc61),
    (0xc80, 0xc80),
    (0xc85, 0xc8c),
    (0xc8e, 0xc90),
    (0xc92, 0xca8),
    (0xcaa, 0xcb3),
    (0xcb5, 0xcb9),
    (0xcbd, 0xcbd),
    (0xcdc, 0xcde),
    (0xce0, 0xce1),
    (0xcf1, 0xcf2),
    (0xd04, 0xd0c),
    (0xd0e, 0xd10),
    (0xd12, 0xd3a),
    (0xd3d, 0xd3d),
    (0xd4e, 0xd4e),
    (0xd54, 0xd56),
    (0xd5f, 0xd61),
    (0xd7a, 0xd7f),
    (0xd85, 0xd96),
    (0xd9a, 0xdb1),
    (0xdb3, 0xdbb),
    (0xdbd, 0xdbd),
    (0xdc0, 0xdc6),
    (0xe01, 0xe30),
    (0xe32, 0xe33),
    (0xe40, 0xe46),
    (0xe81, 0xe82),
    (0xe84, 0xe84),
    (0xe86, 0xe8a),
    (0xe8c, 0xea3),
    (0xea5, 0xea5),
    (0xea7, 0xeb0),
    (0xeb2, 0xeb3),
    (0xebd, 0xebd),
    (0xec0, 0xec4),
    (0xec6, 0xec6),
    (0xedc, 0xedf),
    (0xf00, 0xf00),
    (0xf40, 0xf47),
    (0xf49, 0xf6c),
    (0xf88, 0xf8c),
    (0x1000, 0x102a),
    (0x103f, 0x103f),
    (0x1050, 0x1055),
    (0x105a, 0x105d),
    (0x1061, 0x1061),
    (0x1065, 0x1066),
    (0x106e, 0x1070),
    (0x1075, 0x1081),
    (0x108e, 0x108e),
    (0x10a0, 0x10c5),
    (0x10c7, 0x10c7),
    (0x10cd, 0x10cd),
    (0x10d0, 0x10fa),
    (0x10fc, 0x1248),
    (0x124a, 0x124d),
    (0x1250, 0x1256),
    (0x1258, 0x1258),
    (0x125a, 0x125d),
    (0x1260, 0x1288),
    (0x128a, 0x128d),
    (0x1290, 0x12b0),
    (0x12b2, 0x12b5),
    (0x12b8, 0x12be),
    (0x12c0, 0x12c0),
    (0x12c2, 0x12c5),
    (0x12c8, 0x12d6),
    (0x12d8, 0x1310),
    (0x1312, 0x1315),
    (0x1318, 0x135a),
    (0x1380, 0x138f),
    (0x13a0, 0x13f5),
    (0x13f8, 0x13fd),
    (0x1401, 0x166c),
    (0x166f, 0x167f),
    (0x1681, 0x169a),
    (0x16a0, 0x16ea),
    (0x16f1, 0x16f8),
    (0x1700, 0x1711),
    (0x171f, 0x1731),
    (0x1740, 0x1751),
    (0x1760, 0x176c),
    (0x176e, 0x1770),
    (0x1780, 0x17b3),
    (0x17d7, 0x17d7),
    (0x17dc, 0x17dc),
    (0x1820, 0x1878),
    (0x1880, 0x1884),
    (0x1887, 0x18a8),
    (0x18aa, 0x18aa),
    (0x18b0, 0x18f5),
    (0x1900, 0x191e),
    (0x1950, 0x196d),
    (0x1970, 0x1974),
    (0x1980, 0x19ab),
    (0x19b0, 0x19c9),
    (0x1a00, 0x1a16),
    (0x1a20, 0x1a54),
    (0x1aa7, 0x1aa7),
    (0x1b05, 0x1b33),
    (0x1b45, 0x1b4c),
    (0x1b83, 0x1ba0),
    (0x1bae, 0x1baf),
    (0x1bba, 0x1be5),
    (0x1c00, 0x1c23),
    (0x1c4d, 0x1c4f),
    (0x1c5a, 0x1c7d),
    (0x1c80, 0x1c8a),
    (0x1c90, 0x1cba),
    (0x1cbd, 0x1cbf),
    (0x1ce9, 0x1cec),
    (0x1cee, 0x1cf3),
    (0x1cf5, 0x1cf6),
    (0x1cfa, 0x1cfa),
    (0x1d00, 0x1dbf),
    (0x1e00, 0x1f15),
    (0x1f18, 0x1f1d),
    (0x1f20, 0x1f45),
    (0x1f48, 0x1f4d),
    (0x1f50, 0x1f57),
    (0x1f59, 0x1f59),
    (0x1f5b, 0x1f5b),
    (0x1f5d, 0x1f5d),
    (0x1f5f, 0x1f7d),
    (0x1f80, 0x1fb4),
    (0x1fb6, 0x1fbc),
    (0x1fbe, 0x1fbe),
    (0x1fc2, 0x1fc4),
    (0x1fc6, 0x1fcc),
    (0x1fd0, 0x1fd3),
    (0x1fd6, 0x1fdb),
    (0x1fe0, 0x1fec),
    (0x1ff2, 0x1ff4),
    (0x1ff6, 0x1ffc),
    (0x2071, 0x2071),
    (0x207f, 0x207f),
    (0x2090, 0x209c),
    (0x2102, 0x2102),
    (0x2107, 0x2107),
    (0x210a, 0x2113),
    (0x2115, 0x2115),
    (0x2119, 0x211d),
    (0x2124, 0x2124),
    (0x2126, 0x2126),
    (0x2128, 0x2128),
    (0x212a, 0x212d),
    (0x212f, 0x2139),
    (0x213c, 0x213f),
    (0x2145, 0x2149),
    (0x214e, 0x214e),
    (0x2183, 0x2184),
    (0x2c00, 0x2ce4),
    (0x2ceb, 0x2cee),
    (0x2cf2, 0x2cf3),
    (0x2d00, 0x2d25),
    (0x2d27, 0x2d27),
    (0x2d2d, 0x2d2d),
    (0x2d30, 0x2d67),
    (0x2d6f, 0x2d6f),
    (0x2d80, 0x2d96),
    (0x2da0, 0x2da6),
    (0x2da8, 0x2dae),
    (0x2db0, 0x2db6),
    (0x2db8, 0x2dbe),
    (0x2dc0, 0x2dc6),
    (0x2dc8, 0x2dce),
    (0x2dd0, 0x2dd6),
    (0x2dd8, 0x2dde),
    (0x2e2f, 0x2e2f),
    (0x3005, 0x3006),
    (0x3031, 0x3035),
    (0x303b, 0x303c),
    (0x3041, 0x3096),
    (0x309d, 0x309f),
    (0x30a1, 0x30fa),
    (0x30fc, 0x30ff),
    (0x3105, 0x312f),
    (0x3131, 0x318e),
    (0x31a0, 0x31bf),
    (0x31f0, 0x31ff),
    (0x3400, 0x4dbf),
    (0x4e00, 0xa48c),
    (0xa4d0, 0xa4fd),
    (0xa500, 0xa60c),
    (0xa610, 0xa61f),
    (0xa62a, 0xa62b),
    (0xa640, 0xa66e),
    (0xa67f, 0xa69d),
    (0xa6a0, 0xa6e5),
    (0xa717, 0xa71f),
    (0xa722, 0xa788),
    (0xa78b, 0xa7dc),
    (0xa7f1, 0xa801),
    (0xa803, 0xa805),
    (0xa807, 0xa80a),
    (0xa80c, 0xa822),
    (0xa840, 0xa873),
    (0xa882, 0xa8b3),
    (0xa8f2, 0xa8f7),
    (0xa8fb, 0xa8fb),
    (0xa8fd, 0xa8fe),
    (0xa90a, 0xa925),
    (0xa930, 0xa946),
    (0xa960, 0xa97c),
    (0xa984, 0xa9b2),
    (0xa9cf, 0xa9cf),
    (0xa9e0, 0xa9e4),
    (0xa9e6, 0xa9ef),
    (0xa9fa, 0xa9fe),
    (0xaa00, 0xaa28),
    (0xaa40, 0xaa42),
    (0xaa44, 0xaa4b),
    (0xaa60, 0xaa76),
    (0xaa7a, 0xaa7a),
    (0xaa7e, 0xaaaf),
    (0xaab1, 0xaab1),
    (0xaab5, 0xaab6),
    (0xaab9, 0xaabd),
    (0xaac0, 0xaac0),
    (0xaac2, 0xaac2),
    (0xaadb, 0xaadd),
    (0xaae0, 0xaaea),
    (0xaaf2, 0xaaf4),
    (0xab01, 0xab06),
    (0xab09, 0xab0e),
    (0xab11, 0xab16),
    (0xab20, 0xab26),
    (0xab28, 0xab2e),
    (0xab30, 0xab5a),
    (0xab5c, 0xab69),
    (0xab70, 0xabe2),
    (0xac00, 0xd7a3),
    (0xd7b0, 0xd7c6),
    (0xd7cb, 0xd7fb),
    (0xf900, 0xfa6d),
    (0xfa70, 0xfad9),
    (0xfb00, 0xfb06),
    (0xfb13, 0xfb17),
    (0xfb1d, 0xfb1d),
    (0xfb1f, 0xfb28),
    (0xfb2a, 0xfb36),
    (0xfb38, 0xfb3c),
    (0xfb3e, 0xfb3e),
    (0xfb40, 0xfb41),
    (0xfb43, 0xfb44),
    (0xfb46, 0xfbb1),
    (0xfbd3, 0xfd3d),
    (0xfd50, 0xfd8f),
    (0xfd92, 0xfdc7),
    (0xfdf0, 0xfdfb),
    (0xfe70, 0xfe74),
    (0xfe76, 0xfefc),
    (0xff21, 0xff3a),
    (0xff41, 0xff5a),
    (0xff66, 0xffbe),
    (0xffc2, 0xffc7),
    (0xffca, 0xffcf),
    (0xffd2, 0xffd7),
    (0xffda, 0xffdc),
    (0x10000, 0x1000b),
    (0x1000d, 0x10026),
    (0x10028, 0x1003a),
    (0x1003c, 0x1003d),
    (0x1003f, 0x1004d),
    (0x10050, 0x1005d),
    (0x10080, 0x100fa),
    (0x10280, 0x1029c),
    (0x102a0, 0x102d0),
    (0x10300, 0x1031f),
    (0x1032d, 0x10340),
    (0x10342, 0x10349),
    (0x10350, 0x10375),
    (0x10380, 0x1039d),
    (0x103a0, 0x103c3),
    (0x103c8, 0x103cf),
    (0x10400, 0x1049d),
    (0x104b0, 0x104d3),
    (0x104d8, 0x104fb),
    (0x10500, 0x10527),
    (0x10530, 0x10563),
    (0x10570, 0x1057a),
    (0x1057c, 0x1058a),
    (0x1058c, 0x10592),
    (0x10594, 0x10595),
    (0x10597, 0x105a1),
    (0x105a3, 0x105b1),
    (0x105b3, 0x105b9),
    (0x105bb, 0x105bc),
    (0x105c0, 0x105f3),
    (0x10600, 0x10736),
    (0x10740, 0x10755),
    (0x10760, 0x10767),
    (0x10780, 0x10785),
    (0x10787, 0x107b0),
    (0x107b2, 0x107ba),
    (0x10800, 0x10805),
    (0x10808, 0x10808),
    (0x1080a, 0x10835),
    (0x10837, 0x10838),
    (0x1083c, 0x1083c),
    (0x1083f, 0x10855),
    (0x10860, 0x10876),
    (0x10880, 0x1089e),
    (0x108e0, 0x108f2),
    (0x108f4, 0x108f5),
    (0x10900, 0x10915),
    (0x10920, 0x10939),
    (0x10940, 0x10959),
    (0x10980, 0x109b7),
    (0x109be, 0x109bf),
    (0x10a00, 0x10a00),
    (0x10a10, 0x10a13),
    (0x10a15, 0x10a17),
    (0x10a19, 0x10a35),
    (0x10a60, 0x10a7c),
    (0x10a80, 0x10a9c),
    (0x10ac0, 0x10ac7),
    (0x10ac9, 0x10ae4),
    (0x10b00, 0x10b35),
    (0x10b40, 0x10b55),
    (0x10b60, 0x10b72),
    (0x10b80, 0x10b91),
    (0x10c00, 0x10c48),
    (0x10c80, 0x10cb2),
    (0x10cc0, 0x10cf2),
    (0x10d00, 0x10d23),
    (0x10d4a, 0x10d65),
    (0x10d6f, 0x10d85),
    (0x10e80, 0x10ea9),
    (0x10eb0, 0x10eb1),
    (0x10ec2, 0x10ec7),
    (0x10f00, 0x10f1c),
    (0x10f27, 0x10f27),
    (0x10f30, 0x10f45),
    (0x10f70, 0x10f81),
    (0x10fb0, 0x10fc4),
    (0x10fe0, 0x10ff6),
    (0x11003, 0x11037),
    (0x11071, 0x11072),
    (0x11075, 0x11075),
    (0x11083, 0x110af),
    (0x110d0, 0x110e8),
    (0x11103, 0x11126),
    (0x11144, 0x11144),
    (0x11147, 0x11147),
    (0x11150, 0x11172),
    (0x11176, 0x11176),
    (0x11183, 0x111b2),
    (0x111c1, 0x111c4),
    (0x111da, 0x111da),
    (0x111dc, 0x111dc),
    (0x11200, 0x11211),
    (0x11213, 0x1122b),
    (0x1123f, 0x11240),
    (0x11280, 0x11286),
    (0x11288, 0x11288),
    (0x1128a, 0x1128d),
    (0x1128f, 0x1129d),
    (0x1129f, 0x112a8),
    (0x112b0, 0x112de),
    (0x11305, 0x1130c),
    (0x1130f, 0x11310),
    (0x11313, 0x11328),
    (0x1132a, 0x11330),
    (0x11332, 0x11333),
    (0x11335, 0x11339),
    (0x1133d, 0x1133d),
    (0x11350, 0x11350),
    (0x1135d, 0x11361),
    (0x11380, 0x11389),
    (0x1138b, 0x1138b),
    (0x1138e, 0x1138e),
    (0x11390, 0x113b5),
    (0x113b7, 0x113b7),
    (0x113d1, 0x113d1),
    (0x113d3, 0x113d3),
    (0x11400, 0x11434),
    (0x11447, 0x1144a),
    (0x1145f, 0x11461),
    (0x11480, 0x114af),
    (0x114c4, 0x114c5),
    (0x114c7, 0x114c7),
    (0x11580, 0x115ae),
    (0x115d8, 0x115db),
    (0x11600, 0x1162f),
    (0x11644, 0x11644),
    (0x11680, 0x116aa),
    (0x116b8, 0x116b8),
    (0x11700, 0x1171a),
    (0x11740, 0x11746),
    (0x11800, 0x1182b),
    (0x118a0, 0x118df),
    (0x118ff, 0x11906),
    (0x11909, 0x11909),
    (0x1190c, 0x11913),
    (0x11915, 0x11916),
    (0x11918, 0x1192f),
    (0x1193f, 0x1193f),
    (0x11941, 0x11941),
    (0x119a0, 0x119a7),
    (0x119aa, 0x119d0),
    (0x119e1, 0x119e1),
    (0x119e3, 0x119e3),
    (0x11a00, 0x11a00),
    (0x11a0b, 0x11a32),
    (0x11a3a, 0x11a3a),
    (0x11a50, 0x11a50),
    (0x11a5c, 0x11a89),
    (0x11a9d, 0x11a9d),
    (0x11ab0, 0x11af8),
    (0x11bc0, 0x11be0),
    (0x11c00, 0x11c08),
    (0x11c0a, 0x11c2e),
    (0x11c40, 0x11c40),
    (0x11c72, 0x11c8f),
    (0x11d00, 0x11d06),
    (0x11d08, 0x11d09),
    (0x11d0b, 0x11d30),
    (0x11d46, 0x11d46),
    (0x11d60, 0x11d65),
    (0x11d67, 0x11d68),
    (0x11d6a, 0x11d89),
    (0x11d98, 0x11d98),
    (0x11db0, 0x11ddb),
    (0x11ee0, 0x11ef2),
    (0x11f02, 0x11f02),
    (0x11f04, 0x11f10),
    (0x11f12, 0x11f33),
    (0x11fb0, 0x11fb0),
    (0x12000, 0x12399),
    (0x12480, 0x12543),
    (0x12f90, 0x12ff0),
    (0x13000, 0x1342f),
    (0x13441, 0x13446),
    (0x13460, 0x143fa),
    (0x14400, 0x14646),
    (0x16100, 0x1611d),
    (0x16800, 0x16a38),
    (0x16a40, 0x16a5e),
    (0x16a70, 0x16abe),
    (0x16ad0, 0x16aed),
    (0x16b00, 0x16b2f),
    (0x16b40, 0x16b43),
    (0x16b63, 0x16b77),
    (0x16b7d, 0x16b8f),
    (0x16d40, 0x16d6c),
    (0x16e40, 0x16e7f),
    (0x16ea0, 0x16eb8),
    (0x16ebb, 0x16ed3),
    (0x16f00, 0x16f4a),
    (0x16f50, 0x16f50),
    (0x16f93, 0x16f9f),
    (0x16fe0, 0x16fe1),
    (0x16fe3, 0x16fe3),
    (0x16ff2, 0x16ff3),
    (0x17000, 0x18cd5),
    (0x18cff, 0x18d1e),
    (0x18d80, 0x18df2),
    (0x1aff0, 0x1aff3),
    (0x1aff5, 0x1affb),
    (0x1affd, 0x1affe),
    (0x1b000, 0x1b122),
    (0x1b132, 0x1b132),
    (0x1b150, 0x1b152),
    (0x1b155, 0x1b155),
    (0x1b164, 0x1b167),
    (0x1b170, 0x1b2fb),
    (0x1bc00, 0x1bc6a),
    (0x1bc70, 0x1bc7c),
    (0x1bc80, 0x1bc88),
    (0x1bc90, 0x1bc99),
    (0x1d400, 0x1d454),
    (0x1d456, 0x1d49c),
    (0x1d49e, 0x1d49f),
    (0x1d4a2, 0x1d4a2),
    (0x1d4a5, 0x1d4a6),
    (0x1d4a9, 0x1d4ac),
    (0x1d4ae, 0x1d4b9),
    (0x1d4bb, 0x1d4bb),
    (0x1d4bd, 0x1d4c3),
    (0x1d4c5, 0x1d505),
    (0x1d507, 0x1d50a),
    (0x1d50d, 0x1d514),
    (0x1d516, 0x1d51c),
    (0x1d51e, 0x1d539),
    (0x1d53b, 0x1d53e),
    (0x1d540, 0x1d544),
    (0x1d546, 0x1d546),
    (0x1d54a, 0x1d550),
    (0x1d552, 0x1d6a5),
    (0x1d6a8, 0x1d6c0),
    (0x1d6c2, 0x1d6da),
    (0x1d6dc, 0x1d6fa),
    (0x1d6fc, 0x1d714),
    (0x1d716, 0x1d734),
    (0x1d736, 0x1d74e),
    (0x1d750, 0x1d76e),
    (0x1d770, 0x1d788),
    (0x1d78a, 0x1d7a8),
    (0x1d7aa, 0x1d7c2),
    (0x1d7c4, 0x1d7cb),
    (0x1df00, 0x1df1e),
    (0x1df25, 0x1df2a),
    (0x1e030, 0x1e06d),
    (0x1e100, 0x1e12c),
    (0x1e137, 0x1e13d),
    (0x1e14e, 0x1e14e),
    (0x1e290, 0x1e2ad),
    (0x1e2c0, 0x1e2eb),
    (0x1e4d0, 0x1e4eb),
    (0x1e5d0, 0x1e5ed),
    (0x1e5f0, 0x1e5f0),
    (0x1e6c0, 0x1e6de),
    (0x1e6e0, 0x1e6e2),
    (0x1e6e4, 0x1e6e5),
    (0x1e6e7, 0x1e6ed),
    (0x1e6f0, 0x1e6f4),
    (0x1e6fe, 0x1e6ff),
    (0x1e7e0, 0x1e7e6),
    (0x1e7e8, 0x1e7eb),
    (0x1e7ed, 0x1e7ee),
    (0x1e7f0, 0x1e7fe),
    (0x1e800, 0x1e8c4),
    (0x1e900, 0x1e943),
    (0x1e94b, 0x1e94b),
    (0x1ee00, 0x1ee03),
    (0x1ee05, 0x1ee1f),
    (0x1ee21, 0x1ee22),
    (0x1ee24, 0x1ee24),
    (0x1ee27, 0x1ee27),
    (0x1ee29, 0x1ee32),
    (0x1ee34, 0x1ee37),
    (0x1ee39, 0x1ee39),
    (0x1ee3b, 0x1ee3b),
    (0x1ee42, 0x1ee42),
    (0x1ee47, 0x1ee47),
    (0x1ee49, 0x1ee49),
    (0x1ee4b, 0x1ee4b),
    (0x1ee4d, 0x1ee4f),
    (0x1ee51, 0x1ee52),
    (0x1ee54, 0x1ee54),
    (0x1ee57, 0x1ee57),
    (0x1ee59, 0x1ee59),
    (0x1ee5b, 0x1ee5b),
    (0x1ee5d, 0x1ee5d),
    (0x1ee5f, 0x1ee5f),
    (0x1ee61, 0x1ee62),
    (0x1ee64, 0x1ee64),
    (0x1ee67, 0x1ee6a),
    (0x1ee6c, 0x1ee72),
    (0x1ee74, 0x1ee77),
    (0x1ee79, 0x1ee7c),
    (0x1ee7e, 0x1ee7e),
    (0x1ee80, 0x1ee89),
    (0x1ee8b, 0x1ee9b),
    (0x1eea1, 0x1eea3),
    (0x1eea5, 0x1eea9),
    (0x1eeab, 0x1eebb),
    (0x20000, 0x2a6df),
    (0x2a700, 0x2b81d),
    (0x2b820, 0x2cead),
    (0x2ceb0, 0x2ebe0),
    (0x2ebf0, 0x2ee5d),
    (0x2f800, 0x2fa1d),
    (0x30000, 0x3134a),
    (0x31350, 0x33479),
];
const NUMBERS: &[(u32, u32)] = &[
    (0x30, 0x39),
    (0xb2, 0xb3),
    (0xb9, 0xb9),
    (0xbc, 0xbe),
    (0x660, 0x669),
    (0x6f0, 0x6f9),
    (0x7c0, 0x7c9),
    (0x966, 0x96f),
    (0x9e6, 0x9ef),
    (0x9f4, 0x9f9),
    (0xa66, 0xa6f),
    (0xae6, 0xaef),
    (0xb66, 0xb6f),
    (0xb72, 0xb77),
    (0xbe6, 0xbf2),
    (0xc66, 0xc6f),
    (0xc78, 0xc7e),
    (0xce6, 0xcef),
    (0xd58, 0xd5e),
    (0xd66, 0xd78),
    (0xde6, 0xdef),
    (0xe50, 0xe59),
    (0xed0, 0xed9),
    (0xf20, 0xf33),
    (0x1040, 0x1049),
    (0x1090, 0x1099),
    (0x1369, 0x137c),
    (0x16ee, 0x16f0),
    (0x17e0, 0x17e9),
    (0x17f0, 0x17f9),
    (0x1810, 0x1819),
    (0x1946, 0x194f),
    (0x19d0, 0x19da),
    (0x1a80, 0x1a89),
    (0x1a90, 0x1a99),
    (0x1b50, 0x1b59),
    (0x1bb0, 0x1bb9),
    (0x1c40, 0x1c49),
    (0x1c50, 0x1c59),
    (0x2070, 0x2070),
    (0x2074, 0x2079),
    (0x2080, 0x2089),
    (0x2150, 0x2182),
    (0x2185, 0x2189),
    (0x2460, 0x249b),
    (0x24ea, 0x24ff),
    (0x2776, 0x2793),
    (0x2cfd, 0x2cfd),
    (0x3007, 0x3007),
    (0x3021, 0x3029),
    (0x3038, 0x303a),
    (0x3192, 0x3195),
    (0x3220, 0x3229),
    (0x3248, 0x324f),
    (0x3251, 0x325f),
    (0x3280, 0x3289),
    (0x32b1, 0x32bf),
    (0xa620, 0xa629),
    (0xa6e6, 0xa6ef),
    (0xa830, 0xa835),
    (0xa8d0, 0xa8d9),
    (0xa900, 0xa909),
    (0xa9d0, 0xa9d9),
    (0xa9f0, 0xa9f9),
    (0xaa50, 0xaa59),
    (0xabf0, 0xabf9),
    (0xff10, 0xff19),
    (0x10107, 0x10133),
    (0x10140, 0x10178),
    (0x1018a, 0x1018b),
    (0x102e1, 0x102fb),
    (0x10320, 0x10323),
    (0x10341, 0x10341),
    (0x1034a, 0x1034a),
    (0x103d1, 0x103d5),
    (0x104a0, 0x104a9),
    (0x10858, 0x1085f),
    (0x10879, 0x1087f),
    (0x108a7, 0x108af),
    (0x108fb, 0x108ff),
    (0x10916, 0x1091b),
    (0x109bc, 0x109bd),
    (0x109c0, 0x109cf),
    (0x109d2, 0x109ff),
    (0x10a40, 0x10a48),
    (0x10a7d, 0x10a7e),
    (0x10a9d, 0x10a9f),
    (0x10aeb, 0x10aef),
    (0x10b58, 0x10b5f),
    (0x10b78, 0x10b7f),
    (0x10ba9, 0x10baf),
    (0x10cfa, 0x10cff),
    (0x10d30, 0x10d39),
    (0x10d40, 0x10d49),
    (0x10e60, 0x10e7e),
    (0x10f1d, 0x10f26),
    (0x10f51, 0x10f54),
    (0x10fc5, 0x10fcb),
    (0x11052, 0x1106f),
    (0x110f0, 0x110f9),
    (0x11136, 0x1113f),
    (0x111d0, 0x111d9),
    (0x111e1, 0x111f4),
    (0x112f0, 0x112f9),
    (0x11450, 0x11459),
    (0x114d0, 0x114d9),
    (0x11650, 0x11659),
    (0x116c0, 0x116c9),
    (0x116d0, 0x116e3),
    (0x11730, 0x1173b),
    (0x118e0, 0x118f2),
    (0x11950, 0x11959),
    (0x11bf0, 0x11bf9),
    (0x11c50, 0x11c6c),
    (0x11d50, 0x11d59),
    (0x11da0, 0x11da9),
    (0x11de0, 0x11de9),
    (0x11f50, 0x11f59),
    (0x11fc0, 0x11fd4),
    (0x12400, 0x1246e),
    (0x16130, 0x16139),
    (0x16a60, 0x16a69),
    (0x16ac0, 0x16ac9),
    (0x16b50, 0x16b59),
    (0x16b5b, 0x16b61),
    (0x16d70, 0x16d79),
    (0x16e80, 0x16e96),
    (0x16ff4, 0x16ff6),
    (0x1ccf0, 0x1ccf9),
    (0x1d2c0, 0x1d2d3),
    (0x1d2e0, 0x1d2f3),
    (0x1d360, 0x1d378),
    (0x1d7ce, 0x1d7ff),
    (0x1e140, 0x1e149),
    (0x1e2f0, 0x1e2f9),
    (0x1e4f0, 0x1e4f9),
    (0x1e5f1, 0x1e5fa),
    (0x1e8c7, 0x1e8cf),
    (0x1e950, 0x1e959),
    (0x1ec71, 0x1ecab),
    (0x1ecad, 0x1ecaf),
    (0x1ecb1, 0x1ecb4),
    (0x1ed01, 0x1ed2d),
    (0x1ed2f, 0x1ed3d),
    (0x1f100, 0x1f10c),
    (0x1fbf0, 0x1fbf9),
];

// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Layout and initial pinned Revenue identity; data and definitions come from the portable corpus.
export const dashboardLayout = {
  "id": "d1",
  "name": "SEC linked statements",
  "tabs": [
    {
      "id": "t1",
      "name": "Statements",
      "cards": [
        {
          "id": "facts",
          "widgetId": "local_table",
          "backendId": "builtin",
          "title": "SEC company facts",
          "params": {
            "file": "00000000-0000-0000-0000-000000000001.csv"
          },
          "layout": {
            "x": 0,
            "y": 0,
            "w": 40,
            "h": 9
          },
          "tableDefinition": {
            "table": {},
            "search": "",
            "analytical": {
              "schemaVersion": 1,
              "enabled": false,
              "params": {
                "promotePage": true,
                "filters": [
                  {
                    "id": "company-param",
                    "categoryId": "company-category",
                    "label": "Company",
                    "multiSelect": true
                  }
                ]
              },
              "categories": [
                {
                  "id": "company-category",
                  "name": "Company",
                  "sourceFieldId": "company",
                  "transform": "native"
                }
              ],
              "measures": [],
              "formulas": [],
              "layout": {
                "rows": [],
                "columns": [],
                "values": []
              },
              "checklists": [
                {
                  "categoryId": "company-category",
                  "memberKeys": [
                    "[\"string\",\"CIK:0001045810\"]"
                  ]
                }
              ],
              "resultFilters": [],
              "subtotals": {
                "grandTotal": false,
                "groups": false
              }
            }
          }
        },
        {
          "id": "statement",
          "widgetId": "local_table",
          "backendId": "builtin",
          "title": "Verified SEC statement",
          "params": {},
          "linkedSource": {
            "kind": "widget",
            "sourceWidgetId": "facts"
          },
          "layout": {
            "x": 0,
            "y": 9,
            "w": 20,
            "h": 18
          },
          "tableDefinition": {},
          "tableSelection": {
            "kind": "explicit",
            "ids": [
              "[\"group\",\"[[\\\"statement/sec-nvda-reference/1.0.0/category/section\\\",\\\"[\\\\\\\"statement/sec-nvda-reference/1.0.0/field/section\\\\\\\",\\\\\\\"native\\\\\\\",null,null]\\\"],[\\\"statement/sec-nvda-reference/1.0.0/category/item\\\",\\\"[\\\\\\\"item\\\\\\\",\\\\\\\"native\\\\\\\",null,null]\\\"],[\\\"statement/sec-nvda-reference/1.0.0/category/period\\\",\\\"[\\\\\\\"[\\\\\\\\\\\\\\\"report_end\\\\\\\\\\\\\\\",\\\\\\\\\\\\\\\"FY\\\\\\\\\\\\\\\",null,[\\\\\\\\\\\\\\\"company\\\\\\\\\\\\\\\",\\\\\\\\\\\\\\\"report_end\\\\\\\\\\\\\\\",null,\\\\\\\\\\\\\\\"report_start\\\\\\\\\\\\\\\",\\\\\\\\\\\\\\\"report_end\\\\\\\\\\\\\\\",\\\\\\\\\\\\\\\"year\\\\\\\\\\\\\\\",null,\\\\\\\\\\\\\\\"FY\\\\\\\\\\\\\\\"]]\\\\\\\",\\\\\\\"[[],[]]\\\\\\\"]\\\"]]\",\"[\\\"string\\\",\\\"statement/sec-nvda-reference/1.0.0/section/income\\\"]\\u001f[\\\"string\\\",\\\"statement/sec-nvda-reference/1.0.0/line/revenue\\\"]\"]"
            ]
          }
        },
        {
          "id": "chart",
          "widgetId": "linked_chart",
          "backendId": "builtin",
          "title": "Selected line \u2014 FY2024",
          "params": {},
          "linkedSource": {
            "kind": "widget",
            "sourceWidgetId": "usd-lines"
          },
          "linkedChart": {
            "type": "column",
            "measures": [
              "[\"string\",\"FY2024\"]\u001fstatement/sec-nvda-reference/1.0.0/measure/value"
            ],
            "display": "grouped",
            "category": "\u001egroup"
          },
          "layout": {
            "x": 20,
            "y": 9,
            "w": 20,
            "h": 18
          }
        },
        {
          "id": "usd-lines",
          "widgetId": "local_table",
          "backendId": "builtin",
          "title": "USD-only selected lines",
          "params": {},
          "linkedSource": {
            "kind": "widget",
            "sourceWidgetId": "statement"
          },
          "layout": {
            "x": 0,
            "y": 27,
            "w": 40,
            "h": 8
          },
          "tableDefinition": {
            "table": {},
            "search": "",
            "analytical": {
              "schemaVersion": 1,
              "enabled": false,
              "params": {
                "promotePage": false,
                "filters": []
              },
              "categories": [
                {
                  "id": "line-label",
                  "name": "Line",
                  "sourceFieldId": "\u001egroup",
                  "transform": "native"
                }
              ],
              "measures": [],
              "formulas": [],
              "layout": {
                "rows": [],
                "columns": [],
                "values": []
              },
              "checklists": [
                {
                  "categoryId": "line-label",
                  "memberKeys": []
                }
              ],
              "resultFilters": [],
              "subtotals": {
                "groups": false,
                "grandTotal": false
              }
            }
          }
        }
      ]
    }
  ]
};

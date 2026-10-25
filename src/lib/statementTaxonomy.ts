// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Which section of a financial statement each line item belongs to, keyed by
 * the field names OpenBB's FMP and EODHD providers emit (EODHD's mapped names
 * ARE FMP's names -- that was the parity rule -- so one list covers both).
 * OpenBB's standard statement models carry only the three period fields;
 * every line item is a provider field, which is why this lives in the app.
 *
 * Object insertion order is display order, for sections and for the fields
 * inside them. A field not listed lands in OTHER_SECTION, so a provider that
 * adds a line is shown, not hidden. FMP's income-statement per-share and
 * share-count lines (EPS, weighted-average shares) are deliberately unlisted:
 * they are not dollar lines and read wrong under Profit. The balance sheet's
 * `common_shares_outstanding` is listed, under Equity, because that is where
 * the statement reports it.
 */
export type Statement = "income" | "balance" | "cash";

export const OTHER_SECTION = "Other";

/** Never a line item, whatever its type: the row's identity, not its content. */
export const IDENTITY_FIELDS: ReadonlySet<string> = new Set([
  "symbol", "cik", "period", "period_ending", "fiscal_period", "fiscal_year",
  "filing_date", "accepted_date", "reported_currency", "currency", "currency_symbol", "date",
]);

export const TAXONOMY: Record<Statement, Record<string, readonly string[]>> = {
  income: {
    Income: [
      "revenue", "operating_revenue", "interest_income", "net_interest_income",
      "non_operating_income_net_other", "non_operating_income_excluding_interest",
      "total_other_income_expense_net", "total_other_income_expenses", "other_items",
      "extraordinary_items", "non_recurring",
    ],
    Expenses: [
      "cost_of_revenue", "cost_and_expenses", "research_and_development_expense",
      "selling_and_marketing_expenses", "selling_and_marketing_expense",
      "selling_general_and_administrative_expense", "selling_general_and_admin_expense",
      "general_and_admin_expense", "other_operating_expenses", "other_expenses",
      "total_operating_expenses", "depreciation_and_amortization", "reconciled_depreciation",
      "interest_expense", "total_interest_expense", "income_tax_expense", "tax_provision",
      "effect_of_accounting_charges", "minority_interest", "preferred_stock_and_other_adjustments",
      "other_adjustments_to_net_income", "net_income_deductions",
    ],
    Profit: [
      "gross_profit", "operating_income", "total_operating_income", "ebit", "ebitda",
      "income_before_tax", "total_pre_tax_income", "net_income_from_continuing_ops",
      "net_income_from_continuing_operations", "net_income_from_discontinued_operations",
      "discontinued_operations", "consolidated_net_income", "net_income", "net_income_to_common",
      "bottom_line_net_income",
    ],
  },
  balance: {
    Assets: [
      "cash", "cash_and_cash_equivalents", "short_term_investments", "cash_and_short_term_investments",
      "accounts_receivables", "other_receivables", "net_receivables", "inventory", "prepaid_expenses",
      "other_current_assets", "total_current_assets", "long_term_investments", "total_investments",
      "property_plant_equipment", "property_plant_and_equipment_gross", "accumulated_depreciation",
      "property_plant_equipment_net", "plant_property_equipment_net", "goodwill", "intangible_assets",
      "goodwill_and_intangible_assets", "accumulated_amortization", "deferred_long_term_asset_charges",
      "tax_assets", "other_non_current_assets", "non_currrent_assets_other", "non_current_assets",
      "non_current_assets_total", "other_assets", "earning_assets", "net_tangible_assets", "total_assets",
    ],
    Liabilities: [
      "accounts_payable", "accrued_expenses", "short_term_debt", "short_long_term_debt", "tax_payables",
      "current_deferred_revenue", "other_current_liabilities", "other_current_liab", "other_payables",
      "total_payables", "total_current_liabilities", "long_term_debt", "long_term_debt_total",
      "deferred_revenue_non_current", "deferred_tax_liabilities_non_current", "deferred_long_term_liab",
      "capital_lease_obligations_current", "capital_lease_obligations_non_current", "capital_lease_obligations",
      "other_non_current_liabilities", "non_current_liabilities_other", "total_non_current_liabilities",
      "non_current_liabilities_total", "other_liabilities", "other_liab", "total_liabilities", "total_debt",
      "net_debt",
    ],
    Equity: [
      "preferred_stock", "preferred_stock_total_equity", "preferred_stock_redeemable", "common_stock",
      "common_stock_total_equity", "capital_stock", "treasury_stock", "retained_earnings",
      "retained_earnings_total_equity", "additional_paid_in_capital", "capital_surpluse",
      "accumulated_other_comprehensive_income", "other_shareholders_equity", "other_stockholder_equity",
      "other_total_shareholders_equity", "total_common_equity", "minority_interest",
      "noncontrolling_interest_in_consolidated_entity", "temporary_equity_redeemable_noncontrolling_interests",
      "total_equity_non_controlling_interests", "total_permanent_equity", "total_shareholders_equity",
      "warrants", "negative_goodwill", "liabilities_and_stockholders_equity",
      "total_liabilities_and_shareholders_equity", "total_liabilities_and_total_equity",
      "common_shares_outstanding", "net_working_capital", "net_invested_capital",
    ],
  },
  cash: {
    Operating: [
      "net_income", "depreciation_and_amortization", "deferred_income_tax", "stock_based_compensation",
      "change_in_working_capital", "change_in_account_receivables", "change_receivables",
      "change_to_account_receivables", "change_in_inventory", "change_to_inventory",
      "change_in_account_payable", "change_to_liabilities", "change_in_other_working_capital",
      "change_to_operating_activities", "change_in_other_non_cash_items", "other_non_cash_items",
      "change_to_netincome", "cash_flows_other_operating", "net_cash_from_operating_activities",
      "operating_cash_flow",
      // yfinance's own spellings for the operating section.
      "net_income_from_continuing_operations", "depreciation_amortization_depletion", "deferred_tax",
      "changes_in_account_receivables", "change_in_receivables", "change_in_payable",
      "change_in_payables_and_accrued_expense", "change_in_other_current_assets",
      "change_in_other_current_liabilities", "cash_flow_from_continuing_operating_activities",
    ],
    Investing: [
      "capital_expenditure", "purchase_of_property_plant_and_equipment", "acquisitions", "investments",
      "purchase_of_investment_securities", "sale_and_maturity_of_investments", "other_investing_activities",
      "other_cashflows_from_investing_activities", "net_cash_from_investing_activities",
      // yfinance's own spellings for the investing section.
      "investments_in_property_plant_and_equipment", "net_ppe_purchase_and_sale", "purchase_of_business",
      "net_business_purchase_and_sale", "purchase_of_investment", "sale_of_investment",
      "net_investment_purchase_and_sale", "net_other_investing_changes",
      "cash_flow_from_continuing_investing_activities", "investing_cash_flow",
    ],
    Financing: [
      "net_borrowings", "repayment_of_debt", "short_term_net_debt_issuance", "long_term_net_debt_issuance",
      "net_debt_issuance", "issuance_of_capital_stock", "issuance_of_common_equity",
      "repurchase_of_common_equity", "sale_purchase_of_stock", "net_common_equity_issuance",
      "net_preferred_equity_issuance", "net_equity_issuance", "dividends_paid", "common_dividends_paid",
      "preferred_dividends_paid", "net_dividends_paid", "other_financing_activities",
      "other_cashflows_from_financing_activities", "net_cash_from_financing_activities",
      // yfinance's own spellings for the financing section.
      "long_term_debt_issuance", "long_term_debt_payments", "net_long_term_debt_issuance",
      "net_short_term_debt_issuance", "net_issuance_payments_of_debt", "net_common_stock_issuance",
      "common_stock_dividend_paid", "cash_dividends_paid", "net_other_financing_charges",
      "cash_flow_from_continuing_financing_activities", "financing_cash_flow", "issuance_of_debt",
      "repurchase_of_capital_stock",
    ],
    "Cash position": [
      "exchange_rate_changes", "effect_of_exchange_rate_changes_on_cash", "net_change_in_cash",
      "net_change_in_cash_and_equivalents", "cash_and_cash_equivalents_changes", "cash_at_beginning_of_period",
      "cash_at_end_of_period", "free_cash_flow", "income_taxes_paid", "interest_paid",
      // yfinance's own spellings for the cash-position section.
      "beginning_cash_position", "end_cash_position", "income_tax_paid_supplemental_data",
      "interest_paid_supplemental_data",
    ],
  },
};

/**
 * Which statement a row set is, from the union of its keys. Cash flow is
 * tested first because its rows carry `net_income` too; the balance sheet
 * next; income last. Null for any other table -- the Pivot mode is then
 * simply not offered.
 */
export function detectStatement(fields: Iterable<string>): Statement | null {
  const has = new Set(fields);
  // `operating_cash_flow` is yfinance's anchor for the same statement the FMP
  // name marks; neither the balance sheet nor the income statement carries
  // either, so the cash-first order is unaffected.
  if (has.has("net_cash_from_operating_activities") || has.has("operating_cash_flow")) return "cash";
  if (has.has("total_assets")) return "balance";
  if (has.has("revenue") || has.has("net_income")) return "income";
  return null;
}

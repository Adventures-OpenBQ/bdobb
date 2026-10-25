// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { IDENTITY_FIELDS, TAXONOMY, detectStatement, type Statement } from "./statementTaxonomy";

// The field lists a live EODHD AAPL quarterly row carried on 2026-09-14,
// identity fields removed. The taxonomy must place every one of them.
const EODHD_INCOME = "research_and_development_expense effect_of_accounting_charges income_before_tax minority_interest net_income selling_general_and_administrative_expense selling_and_marketing_expenses gross_profit reconciled_depreciation ebit ebitda depreciation_and_amortization non_operating_income_net_other operating_income other_operating_expenses interest_expense tax_provision interest_income net_interest_income extraordinary_items non_recurring other_items income_tax_expense revenue total_operating_expenses cost_of_revenue total_other_income_expense_net discontinued_operations net_income_from_continuing_ops net_income_to_common preferred_stock_and_other_adjustments".split(" ");
const EODHD_BALANCE = "total_assets intangible_assets earning_assets other_current_assets total_liabilities total_shareholders_equity deferred_long_term_liab other_current_liab common_stock capital_stock retained_earnings other_liab goodwill other_assets cash cash_and_cash_equivalents total_current_liabilities current_deferred_revenue net_debt short_term_debt short_long_term_debt total_debt other_stockholder_equity property_plant_equipment total_current_assets long_term_investments net_tangible_assets short_term_investments net_receivables long_term_debt inventory accounts_payable total_permanent_equity noncontrolling_interest_in_consolidated_entity temporary_equity_redeemable_noncontrolling_interests accumulated_other_comprehensive_income additional_paid_in_capital common_stock_total_equity preferred_stock_total_equity retained_earnings_total_equity treasury_stock accumulated_amortization non_currrent_assets_other deferred_long_term_asset_charges non_current_assets_total capital_lease_obligations long_term_debt_total non_current_liabilities_other non_current_liabilities_total negative_goodwill warrants preferred_stock_redeemable capital_surpluse liabilities_and_stockholders_equity cash_and_short_term_investments property_plant_and_equipment_gross property_plant_equipment_net accumulated_depreciation net_working_capital net_invested_capital common_shares_outstanding".split(" ");
const EODHD_CASH = "investments change_to_liabilities net_cash_from_investing_activities net_borrowings net_cash_from_financing_activities change_to_operating_activities net_income net_change_in_cash cash_at_beginning_of_period cash_at_end_of_period net_cash_from_operating_activities issuance_of_capital_stock depreciation_and_amortization other_cashflows_from_investing_activities dividends_paid change_to_inventory change_to_account_receivables sale_purchase_of_stock other_cashflows_from_financing_activities change_to_netincome capital_expenditure change_receivables cash_flows_other_operating exchange_rate_changes cash_and_cash_equivalents_changes change_in_working_capital stock_based_compensation other_non_cash_items free_cash_flow".split(" ");

function placed(statement: Statement): Set<string> {
  return new Set(Object.values(TAXONOMY[statement]).flat());
}

describe("TAXONOMY", () => {
  it.each(["income", "balance", "cash"] as const)("%s: no field sits in two sections", (statement) => {
    const all = Object.values(TAXONOMY[statement]).flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it("places every line item a live EODHD AAPL row carries", () => {
    expect(EODHD_INCOME.filter((f) => !placed("income").has(f))).toEqual([]);
    expect(EODHD_BALANCE.filter((f) => !placed("balance").has(f))).toEqual([]);
    expect(EODHD_CASH.filter((f) => !placed("cash").has(f))).toEqual([]);
  });

  it("orders the income sections Income, Expenses, Profit", () => {
    expect(Object.keys(TAXONOMY.income)).toEqual(["Income", "Expenses", "Profit"]);
    expect(Object.keys(TAXONOMY.balance)).toEqual(["Assets", "Liabilities", "Equity"]);
    expect(Object.keys(TAXONOMY.cash)).toEqual(["Operating", "Investing", "Financing", "Cash position"]);
  });

  it("never lists an identity field", () => {
    for (const statement of ["income", "balance", "cash"] as const) {
      for (const f of placed(statement)) expect(IDENTITY_FIELDS.has(f)).toBe(false);
    }
  });
});

describe("detectStatement", () => {
  it("cash before balance before income, because a cash-flow row carries net_income too", () => {
    expect(detectStatement(["net_income", "net_cash_from_operating_activities", "total_assets"])).toBe("cash");
    expect(detectStatement(["net_income", "total_assets"])).toBe("balance");
    expect(detectStatement(["period_ending", "revenue"])).toBe("income");
    expect(detectStatement(["period_ending", "net_income"])).toBe("income");
  });

  it("is null for anything else", () => {
    expect(detectStatement(["symbol", "price"])).toBeNull();
    expect(detectStatement([])).toBeNull();
  });
});

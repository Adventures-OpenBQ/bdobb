// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from "react";
import type { DiagnosticCode } from "../renderers/KeysRenderer";
import { checkLabel, CREDENTIAL_LABEL, type Provider } from "../../lib/providerAvailability";
import { usageResetLine, usageSummary } from "../../lib/providerUsage";
import { useChildDialog } from "../../hooks/useChildDialog";
import { DialogShell } from "../dialogs/DialogShell";

type ProviderDetailsDialogProps = {
  provider: Provider;
  tier: number;
  backendName: string;
  onClose: () => void;
  onTest: (envVar: string) => void;
  onSubmit: (envVar: string, value: string) => Promise<{ restart_required?: boolean }>;
};

/**
 * The fixed observation and next step per connectivity code. Only the firewall
 * and timeout wording is spec-mandated (spec §5): the firewall text sends the
 * operator to the outbound allowlist; the timeout text says a timeout does not
 * prove a firewall block. The rest are fixed, non-inferential descriptions so
 * the app never guesses a cause it did not observe.
 */
const DIAGNOSTICS: Record<Exclude<DiagnosticCode, "not_installed">, { observation: string; next: string }> = {
  dns_failure: {
    observation: "The backend could not resolve the provider's hostname. No connection was attempted.",
    next: "Check the backend's DNS configuration and that the provider's hostname is correct, then retest.",
  },
  connect_timeout: {
    observation: "The backend could not establish a connection within the time limit. No provider response was received; the cause is not confirmed.",
    next: "Check the provider's service status and the backend's DNS, proxy, route, and firewall rules, then retry. A timeout alone does not prove a firewall block.",
  },
  connect_refused: {
    observation: "The provider's host actively refused the connection. The address was reached but nothing accepted the connection.",
    next: "Confirm the provider endpoint and port are correct and that the service is accepting connections, then retest.",
  },
  tls_error: {
    observation: "The TLS handshake with the provider failed. The connection was reached but could not be secured.",
    next: "Check the backend's system clock and certificate trust store, and that the provider's certificate is valid, then retest.",
  },
  http_auth: {
    observation: "The provider responded and rejected the credential. The key reached the vendor and was refused.",
    next: "Confirm the credential is current and has access to the requested data, then submit a corrected key and retest.",
  },
  rate_limited: {
    observation: "The provider responded that the request rate was exceeded. The credential reached the vendor.",
    next: "Wait for the provider's rate window to reset, or reduce request volume, then retest.",
  },
  upstream_error: {
    observation: "The provider responded with a server-side error. The request reached the vendor but the vendor failed to serve it.",
    next: "Check the provider's service status and retry later. Repeated errors are the provider's to resolve.",
  },
  unexpected_response: {
    observation: "The provider responded with something the backend could not interpret as a valid result.",
    next: "Check the provider's service status and that the backend targets a supported endpoint, then retest.",
  },
  egress_policy_denied: {
    observation: "The outbound proxy returned an explicit policy-denied response. This is a confirmed block, not an inference from a timeout.",
    next: "Review the data backend's outbound proxy or firewall allowlist for this registered provider. Retest after an administrator approves the required destination.",
  },
};

/** No checked_at means no timestamp on screen (spec §6): the fixed phrase, never a fabricated time. */
function formatCheckedAt(iso: string | undefined): string {
  if (iso === undefined) return "time not recorded";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "time not recorded" : d.toLocaleString();
}

/**
 * The per-provider Details child dialog (spec §5): the status line, the
 * diagnostic block for a connectivity code, Test/Retest, and — at tier 3 only —
 * the masked key editor. It uses useChildDialog, so it opens over Settings in
 * the top layer and one Escape closes it alone through the shared modal stack;
 * this component registers no Escape handling itself. restart/submitFailed are
 * local, exactly as they are in the widget's KeysRenderer edit form.
 */
export function ProviderDetailsDialog({ provider, tier, backendName, onClose, onTest, onSubmit }: ProviderDetailsDialogProps) {
  const dialogRef = useChildDialog(onClose);
  const [manageOpen, setManageOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [restart, setRestart] = useState(false);
  const [submitFailed, setSubmitFailed] = useState(false);

  // The form must not outlive the authority to use it: a tier that drops below
  // 3 closes any open edit and drops its draft, not just hides the button.
  useEffect(() => {
    if (tier !== 3) {
      setManageOpen(false);
      setDraft("");
    }
  }, [tier]);

  // not_installed is a code but not a connectivity diagnostic, so it never
  // opens the "Connectivity check / What happened" block.
  const diagCode = provider.code !== undefined && provider.code !== "not_installed" ? provider.code : undefined;
  const diag = diagCode !== undefined ? DIAGNOSTICS[diagCode] : undefined;
  const diagBlock =
    diag !== undefined ? (
      <>
        <code>{diagCode}</code>
        <h3>What happened</h3>
        <p>{diag.observation}</p>
        <h3>What to check</h3>
        <p>{diag.next}</p>
      </>
    ) : null;
  const checks = provider.checks ?? [];

  return (
    <DialogShell
      dialogRef={dialogRef}
      ariaLabel={provider.name}
      title={provider.name}
      subtitle="Provider status and secondary actions"
      modifier="bd-dialog--editor"
      plain
      onClose={onClose}
      note={
        <button type="button" className="bd-button" onClick={onClose}>
          Done
        </button>
      }
      footerActions={
        <>
          {tier === 3 ? (
            <button
              type="button"
              className="bd-button"
              onClick={() => {
                setManageOpen(true);
                setDraft("");
              }}
            >
              Manage key
            </button>
          ) : null}
          {provider.testable ? (
            <button type="button" className="bd-button" onClick={() => onTest(provider.envVar)}>
              {provider.tested ? "Retest" : "Test"}
            </button>
          ) : null}
        </>
      }
    >
      {/* role=status because Test changes this line in place. */}
      <div className="bd-provider-state" data-tone={provider.category} role="status">
        {provider.statusLabel}
      </div>
      <p>{`Credential: ${CREDENTIAL_LABEL[provider.credential]}`}</p>
      <p className="bd-muted">{provider.explanation}</p>
      {checks.length > 0 ? (
        // Every check the backend ran, one line each (spec amendment). The
        // rich What-happened/What-to-check block still follows for the worse
        // connectivity code, when there is one.
        <div className="bd-provider-diagnostic">
          {checks.map((c, i) => (
            <p key={`${c.kind}-${i}`} className="bd-muted">
              {`${c.kind === "credential" ? "Credential" : "Connectivity"} check · ${checkLabel(c)}${c.checked_at !== undefined ? ` · ${formatCheckedAt(c.checked_at)}` : ""}`}
            </p>
          ))}
          {diagBlock}
        </div>
      ) : diag !== undefined ? (
        <div className="bd-provider-diagnostic">
          <p className="bd-muted">{`Connectivity check · ${backendName} · ${formatCheckedAt(provider.checkedAt)}`}</p>
          {diagBlock}
        </div>
      ) : provider.keyRequired === false ? (
        <p className="bd-notice">This provider needs no credential. Availability still depends on the latest service test.</p>
      ) : null}
      {provider.usage !== undefined ? (
        // From the credential check; as old as that check (spec: refreshed only
        // when a test runs).
        <div className="bd-provider-diagnostic">
          <h3>API usage</h3>
          <p>{usageSummary(provider.usage)}</p>
          {usageResetLine(provider.usage) !== undefined ? (
            <p className="bd-muted">{usageResetLine(provider.usage)}</p>
          ) : null}
          {provider.usage.extra !== undefined && provider.usage.extra > 0 ? (
            <p className="bd-muted">{`Extra calls remaining: ${provider.usage.extra.toLocaleString()}`}</p>
          ) : null}
          <p className="bd-muted">{`As of ${formatCheckedAt(provider.checks?.find((c) => c.kind === "credential")?.checked_at)}`}</p>
        </div>
      ) : null}
      {manageOpen && tier === 3 ? (
        <form
          className="bd-form"
          onSubmit={(e) => {
            e.preventDefault();
            const value = draft;
            // Cleared before the await: the draft must not outlive the submit
            // in component state.
            setManageOpen(false);
            setDraft("");
            setSubmitFailed(false);
            void onSubmit(provider.envVar, value)
              .then((r) => setRestart(Boolean(r?.restart_required)))
              .catch(() => setSubmitFailed(true));
          }}
        >
          <div className="bd-field">
            <label htmlFor="provider-new-value">New value</label>
            {/* type=password so a shoulder-surfer and a screenshot see nothing;
                the value is never echoed back after submit. */}
            <input
              id="provider-new-value"
              className="bd-input"
              type="password"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </div>
          <button type="submit" className="bd-button bd-button--primary">
            Save
          </button>
        </form>
      ) : null}
      {restart ? (
        <p className="bd-notice" role="status">
          Saved. The running <code>openbq-api</code> container cannot see this change — its environment is fixed when
          the process starts. Restart it to pick the key up.
        </p>
      ) : null}
      {submitFailed ? (
        // Fixed message only — never text derived from the rejection. A
        // network-layer error can carry a URL (which may itself carry the
        // submitted value, e.g. in a query string), so nothing from `error`
        // is shown here.
        <p className="bd-notice bd-notice--error" role="status">
          Save failed. The key was not updated.
        </p>
      ) : null}
    </DialogShell>
  );
}

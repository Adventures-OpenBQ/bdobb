# Closed-session detailed chart and compact Day Chart controls

Goal: a linked detailed Live Chart draws latest completed US regular-session OHLCV when closed; Day Chart layout/output controls sit bottom-right.

Architecture: advertised closed_session_history capability on the live_chart manifest. A bounded authenticated /closed_session endpoint uses existing XNYS select_session and EODHD 1m history, clips to real session, validates OHLCV, resamples to approved minute/day widths. Provider bars are labelled historical EODHD, never appended to accepted tick state/cursors. Open US sessions and non-US instruments retain chart-stream-v1. Explicit start/end retains caller's accepted view. Poll metadata every15s for market transitions, abort/generation guards on symbol/auth/interval changes. Below-minute closed history shows a clear unavailable message; no invented1s bars.

Tasks:
- [ ] RED tests closed Sunday/holiday/earlyclose, open/no-provider-fetch, non-US passthrough, OHLCV validation/bounds/coalescing/resampling.
- [ ] Backend endpoint+cache+manifest+exact gateway policy; frontend capability normalization and closed history hook with bounded response validation, cancellation and transition tests.
- [ ] Renderer chooses labelled closed history vs accepted candles, redraws on linked symbol change; keep crypto and explicit ranges working.
- [ ] Move row>0 Day Chart standard ParamControls into footer right; row0 Symbols stays title. Reuse group controls and persistence.
- [ ] Focused/full tests, lint/typecheck, publish matching source, deploy Mac service/gateway and Vercel, verify AAPL/MSFT/NVDA clicks show distinct real session candles with saved linkage.

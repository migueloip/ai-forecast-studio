# Forecast Intelligence Engine V2 — Scientific Audit

## Decision

V1 was not approved for production forecasting. V2 replaces the four material weaknesses found during review: single-holdout model selection, unvalidated ensembles, heuristic prediction intervals, and subjective confidence scoring.

## Audit findings and corrections

| Area | V1 finding | V2 control |
|---|---|---|
| Temporal validation | One final holdout could select a model because of one convenient period. | Every eligible model receives identical expanding-window walk-forward origins and horizon. Random splits are prohibited and reported as `randomSplit: false`. |
| Eligibility | Fixed minimum counts did not account for dataset class, frequency, seasonal length, regularity, or validation history. | Eligibility combines size class, earliest common training window, frequency-specific seasonal cycles, signal detection, regularity, dependency availability, and compute role. Every rejection includes required characteristics and an explicit reason. |
| Tournament objective | Lowest holdout RMSE dominated selection. | Objective score = 72% RMSE relative to the naive baseline + 18% fold-instability penalty + 10% bounded error penalty. All constituent metrics remain visible. |
| Ensemble | Models within 20% of the winner were combined without proving improvement. | Ensembles are considered on large histories only. Inverse-squared-RMSE weights are accepted only when the combined out-of-fold RMSE improves by at least 1% and the objective score beats the best single model. Weights are persisted. |
| Intervals | One residual quantile was multiplied by an arbitrary square-root rule. | V2 uses finite-sample 95% conformal quantiles from the selected strategy's walk-forward residuals. Step-specific residuals are used when sufficiently sampled; otherwise a pooled conformal quantile is widened by horizon and observed volatility. |
| Confidence | Accuracy, history and completeness were combined with arbitrary coefficients and no audit trail. | Confidence exposes nine named components and weights. The score is reproducible from forecast error, interval width, completeness, history, fold stability, seasonal consistency, challenger agreement, data quality and horizon difficulty. |
| Frequency | Analytics truncated every dataset to 36 monthly points. | Analytics V5 detects daily, weekly, monthly or quarterly cadence and retains up to 2,000 daily, 1,040 weekly, 360 monthly or 120 quarterly periods. Seasonal lengths are 7, 52, 12 and 4 respectively. |
| LLM boundary | The executive schema allowed the LLM to emit forecast changes, forecast confidence and Business Health. | These fields are overwritten with authoritative Analytics V5 values after generation. If no validated forecast exists, forecast fields are null. Meetings may quote existing results but may not calculate new ones. |
| Simulation | Scenario arithmetic used an actual baseline and fixed risk thresholds. | Decision Room can use a model forecast and its 95% interval, applies explicit price/volume/cost equations, propagates downside uncertainty, penalizes extrapolation distance and uses a reproducible risk-tolerance rule. |
| Business Health | Growth potential was absent. | Six visible components now cover revenue, forecast reliability, demand stability, inventory, growth potential and data quality. Missing components are excluded and weights are normalized. |

## Eligibility policy

- Very small, fewer than 12 periods: only linear trend, moving averages and simple exponential smoothing can pass the size gate. Model-specific minimum history still applies to the earliest walk-forward fold.
- Small, 12–35 periods: statistical models may compete. Seasonal models additionally require two observed cycles and stable detected seasonality.
- Medium, 36–100 periods: statistical and tree/boosting models may compete when the earliest common fold contains their required lag history. Deep learning is rejected.
- Large, more than 100 periods: all adapters, including LSTM and GRU, may compete when at least four seasonal cycles and the common validation history are available.

Being in an allowed class does not guarantee training. A model is still rejected when its scientific assumptions are not supported.

## Validation contract

For every metric, V2 creates two to five expanding-window origins. Each model is refitted at every origin and forecasts the same multi-step horizon. Metrics aggregate the same out-of-fold observations for every competitor:

- MAE, MSE and RMSE
- MAPE where actual values are nonzero
- sMAPE
- MASE where a valid naive scale exists
- R² where validation variance exists
- normalized RMSE and bounded accuracy percentage
- per-fold RMSE stability
- wall-clock training and validation time

No future observation is available to a model at its training origin.

## Confidence methodology

The final score is the weighted sum below, capped below 100 to avoid claiming certainty:

| Component | Weight |
|---|---:|
| Walk-forward forecast error | 25% |
| Conformal interval precision | 15% |
| Dataset completeness | 10% |
| History sufficiency | 10% |
| Model stability across folds | 15% |
| Seasonal consistency | 8% |
| Challenger/ensemble agreement | 7% |
| Data quality, regularity and anomalies | 5% |
| Forecast-horizon difficulty | 5% |

The API returns every component, its weight and the methodology text. Confidence is not generated by an LLM.

## Limitations that remain explicit

- Conformal coverage assumes future residual behavior is sufficiently similar to walk-forward residual behavior. Structural breaks can invalidate coverage.
- Calendar effects are detected as recurring positions; the engine does not name a holiday without an external holiday calendar.
- Correlation is not treated as causality. Unknown future regressors are not silently forecast.
- A deterministic price × volume scenario is conditional on user-provided demand change. It is not a causal price-elasticity estimate.
- Neural networks are challengers, not privileged models. They are selected only when their out-of-fold objective wins.

## Production controls

- Scientific execution runs in an isolated child process with no shell, a fixed script path, capped output and a configurable hard timeout.
- Failed scientific execution never exposes raw errors to the user and preserves the validated TypeScript fallback.
- Results are cached in Neon as Analytics V5 / Engine V2 and recomputed lazily for older datasets.
- Model timing is persisted for latency monitoring. Dataset histories are bounded before crossing the process boundary.

## Measured benchmark in the development environment

- 120 monthly periods, all 19 adapters, 3 walk-forward folds: 30.6 seconds and approximately 857 MB peak RSS before recurrent-network tuning.
- 1,000 daily periods, all 19 adapters, 5 folds × 14-step horizon: 64.7 seconds and approximately 909 MB peak RSS after tuning; LSTM used 16.5 seconds and GRU 17.5 seconds of recorded model time.
- Current Neon dataset, 36 monthly periods, 19 eligibility decisions and 4 folds: 8.5 seconds end to end.

The Node event loop remains responsive because training runs in an isolated child process, but the upload/refresh request waits for completion. Large deep-learning tournaments are therefore suitable for cached analysis, not sub-second interaction. The 180-second process budget remains a required production guardrail.

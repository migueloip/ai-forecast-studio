#!/usr/bin/env python3
"""Forecast Intelligence Engine V2.

All numerical outputs are produced by deterministic statistical/ML adapters.
The process reads one JSON request from stdin and emits one JSON response.
"""

from __future__ import annotations

import importlib.util
import json
import math
import os
import sys
import time
import warnings
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Callable

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
warnings.filterwarnings("ignore")

try:
    import numpy as np
except ImportError as error:
    raise SystemExit(json.dumps({"error": f"numpy is required: {error}"}))


def optional_import(module: str, symbol: str | None = None):
    try:
        imported = __import__(module, fromlist=[symbol] if symbol else [])
        return getattr(imported, symbol) if symbol else imported
    except Exception:
        return None


LinearRegression = optional_import("sklearn.linear_model", "LinearRegression")
RandomForestRegressor = optional_import("sklearn.ensemble", "RandomForestRegressor")
GradientBoostingRegressor = optional_import("sklearn.ensemble", "GradientBoostingRegressor")
SimpleExpSmoothing = optional_import("statsmodels.tsa.holtwinters", "SimpleExpSmoothing")
Holt = optional_import("statsmodels.tsa.holtwinters", "Holt")
ExponentialSmoothing = optional_import("statsmodels.tsa.holtwinters", "ExponentialSmoothing")
ARIMA = optional_import("statsmodels.tsa.arima.model", "ARIMA")
SARIMAX = optional_import("statsmodels.tsa.statespace.sarimax", "SARIMAX")
STL = optional_import("statsmodels.tsa.seasonal", "STL")
Prophet = optional_import("prophet", "Prophet")
XGBRegressor = optional_import("xgboost", "XGBRegressor")
LGBMRegressor = optional_import("lightgbm", "LGBMRegressor")
CatBoostRegressor = optional_import("catboost", "CatBoostRegressor")


MODEL_META = {
    "linear_regression": ("Linear Regression", "statistical", "Transparent trend baseline.", "Misses nonlinear and recurring seasonal changes.", "At least 6 regular periods and an approximately linear trend."),
    "multiple_linear_regression": ("Multiple Linear Regression", "statistical", "Adds deterministic seasonal Fourier terms.", "Does not know future external drivers.", "At least 12 periods with a known regular frequency."),
    "moving_average": ("Moving Average", "statistical", "Stable short-history baseline.", "Lags turning points and cannot extrapolate trend.", "At least 6 ordered observations."),
    "weighted_moving_average": ("Weighted Moving Average", "statistical", "Responds to recent periods.", "Can overreact to a recent anomaly.", "At least 6 ordered observations."),
    "exponential_smoothing": ("Exponential Smoothing", "statistical", "Efficiently estimates a changing level.", "No explicit trend or seasonality.", "At least 8 regular periods."),
    "holt": ("Holt's Method", "statistical", "Models level and damped trend.", "No recurring seasonal component.", "At least 10 regular periods."),
    "holt_winters": ("Holt-Winters", "statistical", "Models level, trend and seasonality.", "Unstable without multiple complete cycles.", "At least two full seasonal cycles and detected seasonality."),
    "arima": ("ARIMA", "statistical", "Models autocorrelation and differenced trend.", "Sensitive to structural breaks and short histories.", "At least 18 regular periods."),
    "sarima": ("SARIMA", "statistical", "Models autocorrelation at seasonal lags.", "Parameter estimation is expensive and data hungry.", "At least two full seasonal cycles with stable seasonality."),
    "prophet": ("Prophet", "statistical", "Handles trend changes and calendar seasonality.", "Can overfit short or nonseasonal histories.", "At least two seasonal cycles or a repeatable calendar effect."),
    "seasonal_decomposition": ("Seasonal Decomposition", "statistical", "Produces an interpretable seasonal profile.", "Assumes a stable additive seasonal pattern.", "At least two full seasonal cycles."),
    "stl": ("STL Decomposition", "statistical", "Robust trend-seasonal decomposition.", "Requires a regular series and repeated cycles.", "At least two full seasonal cycles."),
    "random_forest": ("Random Forest", "machine_learning", "Captures nonlinear lag interactions.", "Weak trend extrapolation and higher variance on short data.", "At least 36 periods and enough lag examples."),
    "gradient_boosting": ("Gradient Boosting", "machine_learning", "Efficient nonlinear lag learner.", "Can overfit without repeated walk-forward folds.", "At least 36 periods and stable temporal patterns."),
    "xgboost": ("XGBoost", "machine_learning", "Regularized nonlinear challenger.", "Complexity is unjustified on small histories.", "At least 48 periods and repeated temporal validation."),
    "lightgbm": ("LightGBM", "machine_learning", "Scales well to long feature histories.", "Leaf-wise growth can overfit short series.", "At least 48 periods and repeated temporal validation."),
    "catboost": ("CatBoost", "machine_learning", "Stable boosting defaults for nonlinear lags.", "Training cost is high for small univariate series.", "At least 48 periods and repeated temporal validation."),
    "lstm": ("LSTM", "deep_learning", "Can learn long nonlinear dependencies.", "Data hungry, stochastic and less interpretable.", "More than 100 periods, four seasonal cycles and stable regularity."),
    "gru": ("GRU", "deep_learning", "Compact recurrent nonlinear model.", "Still needs long histories and stability testing.", "More than 100 periods, four seasonal cycles and stable regularity."),
}


def clean(value: float) -> float:
    return round(float(value), 6) if math.isfinite(float(value)) else 0.0


def parse_period(value: str) -> date:
    return date.fromisoformat(f"{value}-01" if len(value) == 7 else value[:10])


def infer_frequency(periods: list[str], requested: str | None = None) -> tuple[str, int, float]:
    if requested in ("daily", "weekly", "monthly", "quarterly"):
        frequency = requested
    else:
        dates = sorted(set(parse_period(period) for period in periods))
        gaps = [(right - left).days for left, right in zip(dates, dates[1:]) if right > left]
        median = float(np.median(gaps)) if gaps else 30.0
        frequency = "daily" if median <= 2 else "weekly" if median <= 10 else "monthly" if median <= 45 else "quarterly" if median <= 120 else "monthly"
    expected = {"daily": 1, "weekly": 7, "monthly": 30.4375, "quarterly": 91.3125}[frequency]
    dates = sorted(parse_period(period) for period in periods)
    gaps = np.asarray([(right - left).days for left, right in zip(dates, dates[1:])], dtype=float)
    regularity = float(np.mean(np.abs(gaps - expected) <= max(1.0, expected * .25))) if len(gaps) else 1.0
    return frequency, {"daily": 7, "weekly": 52, "monthly": 12, "quarterly": 4}[frequency], regularity


def future_periods(last: str, horizon: int, frequency: str) -> list[str]:
    current = parse_period(last)
    output = []
    for _ in range(horizon):
        if frequency == "daily":
            current += timedelta(days=1)
            output.append(current.isoformat())
        elif frequency == "weekly":
            current += timedelta(days=7)
            output.append(current.isoformat())
        else:
            increment = 3 if frequency == "quarterly" else 1
            month_index = current.year * 12 + current.month - 1 + increment
            current = date(month_index // 12, month_index % 12 + 1, 1)
            output.append(current.strftime("%Y-%m"))
    return output


def metric_values(actual: np.ndarray, predicted: np.ndarray, training: np.ndarray | None = None) -> dict[str, float | None]:
    error = predicted - actual
    mae = float(np.mean(np.abs(error)))
    mse = float(np.mean(error ** 2))
    rmse = math.sqrt(mse)
    mask = np.abs(actual) > 1e-9
    mape = float(np.mean(np.abs(error[mask] / actual[mask])) * 100) if np.any(mask) else None
    smape_denominator = np.abs(actual) + np.abs(predicted)
    smape_mask = smape_denominator > 1e-9
    smape = float(np.mean(200 * np.abs(error[smape_mask]) / smape_denominator[smape_mask])) if np.any(smape_mask) else None
    denominator = float(np.sum((actual - np.mean(actual)) ** 2))
    r2 = 1 - float(np.sum(error ** 2)) / denominator if denominator > 1e-12 else None
    naive_scale = float(np.mean(np.abs(np.diff(training)))) if training is not None and len(training) > 1 else None
    mase = mae / naive_scale if naive_scale and naive_scale > 1e-9 else None
    scale = max(float(np.mean(np.abs(actual))), 1e-9)
    nrmse = rmse / scale
    accuracy = 100 / (1 + nrmse)
    return {"mae": clean(mae), "mse": clean(mse), "rmse": clean(rmse), "mape": None if mape is None else clean(mape), "smape": None if smape is None else clean(smape), "mase": None if mase is None else clean(mase), "r2": None if r2 is None else clean(r2), "normalizedRmse": clean(nrmse), "accuracyPercentage": clean(accuracy)}


def trend_forecast(values: np.ndarray, horizon: int) -> np.ndarray:
    coefficients = np.polyfit(np.arange(len(values), dtype=float), values, 1)
    return np.polyval(coefficients, np.arange(len(values), len(values) + horizon, dtype=float))


def calendar_features(start: int, count: int, season: int) -> np.ndarray:
    indexes = np.arange(start, start + count, dtype=float)
    return np.column_stack([indexes, np.sin(2 * np.pi * indexes / season), np.cos(2 * np.pi * indexes / season)])


def supervised(values: np.ndarray, lags: int, season: int) -> tuple[np.ndarray, np.ndarray]:
    features, targets = [], []
    for index in range(lags, len(values)):
        features.append(list(values[index-lags:index]) + [index, math.sin(2*math.pi*index/season), math.cos(2*math.pi*index/season)])
        targets.append(values[index])
    return np.asarray(features, dtype=float), np.asarray(targets, dtype=float)


def recursive_ml(model: Any, values: np.ndarray, horizon: int, lags: int, season: int) -> np.ndarray:
    history, output = list(map(float, values)), []
    for _ in range(horizon):
        index = len(history)
        row = history[-lags:] + [index, math.sin(2*math.pi*index/season), math.cos(2*math.pi*index/season)]
        value = float(model.predict(np.asarray([row]))[0])
        history.append(value)
        output.append(value)
    return np.asarray(output)


def seasonal_additive(values: np.ndarray, horizon: int, season: int) -> np.ndarray:
    x = np.arange(len(values), dtype=float)
    coefficients = np.polyfit(x, values, 1)
    residuals = values - np.polyval(coefficients, x)
    profile = [float(np.mean(residuals[np.arange(len(values)) % season == position])) for position in range(season)]
    future = np.arange(len(values), len(values) + horizon)
    return np.polyval(coefficients, future) + np.asarray([profile[index % season] for index in future])


def fit_arima(values: np.ndarray, horizon: int) -> np.ndarray:
    best, best_aic = None, float("inf")
    for p in range(3):
        for d in range(2):
            for q in range(2):
                if p == d == q == 0:
                    continue
                try:
                    fitted = ARIMA(values, order=(p, d, q), trend="t" if d == 0 else "n").fit()
                    if fitted.aic < best_aic:
                        best, best_aic = fitted, fitted.aic
                except Exception:
                    continue
    if best is None:
        raise RuntimeError("No stable ARIMA parameterization converged.")
    return np.asarray(best.forecast(horizon), dtype=float)


def fit_sarima(values: np.ndarray, horizon: int, season: int) -> np.ndarray:
    fitted = SARIMAX(values, order=(1,1,1), seasonal_order=(1,0,1,season), enforce_stationarity=False, enforce_invertibility=False).fit(disp=False, maxiter=80)
    return np.asarray(fitted.forecast(horizon), dtype=float)


def fit_prophet(values: np.ndarray, periods: list[str], horizon: int, frequency: str) -> np.ndarray:
    import pandas as pd
    frame = pd.DataFrame({"ds": [parse_period(period).isoformat() for period in periods], "y": values})
    model = Prophet(yearly_seasonality=frequency in ("daily", "weekly"), weekly_seasonality=frequency == "daily", daily_seasonality=False, interval_width=.95)
    model.fit(frame)
    future = model.make_future_dataframe(periods=horizon, freq={"daily":"D", "weekly":"7D", "monthly":"MS", "quarterly":"QS"}[frequency])
    return np.asarray(model.predict(future)["yhat"].tail(horizon), dtype=float)


def fit_stl(values: np.ndarray, horizon: int, season: int) -> np.ndarray:
    fitted = STL(values, period=season, robust=True).fit()
    trend = trend_forecast(np.asarray(fitted.trend), horizon)
    seasonal = np.asarray([fitted.seasonal[(len(values)+index) % season] for index in range(horizon)])
    return trend + seasonal


def fit_deep(values: np.ndarray, horizon: int, season: int, cell: str) -> np.ndarray:
    tf = optional_import("tensorflow")
    if tf is None:
        raise ImportError("tensorflow-cpu is not installed")
    tf.keras.backend.clear_session()
    tf.keras.utils.set_random_seed(42)
    lags = min(max(12, season), 52, len(values)//3)
    minimum, maximum = float(np.min(values)), float(np.max(values))
    scale = maximum-minimum or 1.0
    normalized = (values-minimum)/scale
    x, y = supervised(normalized, lags, season)
    x = x[:, :lags].reshape((-1,lags,1))
    layer = tf.keras.layers.LSTM(12) if cell == "lstm" else tf.keras.layers.GRU(12)
    model = tf.keras.Sequential([tf.keras.layers.Input((lags,1)), layer, tf.keras.layers.Dense(1)])
    model.compile(optimizer="adam", loss="mse")
    model.fit(x, y, epochs=12, batch_size=min(64,len(x)), verbose=0, validation_split=.15, callbacks=[tf.keras.callbacks.EarlyStopping(monitor="val_loss", patience=2, restore_best_weights=True)])
    history, output = list(map(float,normalized)), []
    for _ in range(horizon):
        predicted = float(model.predict(np.asarray(history[-lags:]).reshape((1,lags,1)), verbose=0)[0][0])
        history.append(predicted)
        output.append(predicted*scale+minimum)
    return np.asarray(output)


@dataclass
class Adapter:
    key: str
    minimum: int
    seasonal: bool
    dependency: Any
    fit: Callable[[np.ndarray,list[str],int],np.ndarray]


def adapters(season: int, frequency: str) -> list[Adapter]:
    def ml(constructor: Any, kwargs: dict[str,Any]):
        def run(values: np.ndarray, _periods: list[str], horizon: int):
            lags = min(max(3, season), 52, max(3,len(values)//4))
            x, y = supervised(values,lags,season)
            model = constructor(**kwargs)
            model.fit(x,y)
            return recursive_ml(model,values,horizon,lags,season)
        return run
    seasonal_minimum = max(24, season*2)
    ml_minimum = max(36, season*3)
    deep_minimum = max(101, season*4)
    return [
        Adapter("linear_regression",6,False,True,lambda v,_p,h:trend_forecast(v,h)),
        Adapter("multiple_linear_regression",12,False,LinearRegression,lambda v,_p,h:np.asarray(LinearRegression().fit(calendar_features(0,len(v),season),v).predict(calendar_features(len(v),h,season)))),
        Adapter("moving_average",6,False,True,lambda v,_p,h:np.repeat(np.mean(v[-min(3,len(v)):]),h)),
        Adapter("weighted_moving_average",6,False,True,lambda v,_p,h:np.repeat(np.average(v[-min(4,len(v)):],weights=np.arange(1,min(4,len(v))+1)),h)),
        Adapter("exponential_smoothing",8,False,SimpleExpSmoothing,lambda v,_p,h:np.asarray(SimpleExpSmoothing(v,initialization_method="estimated").fit().forecast(h))),
        Adapter("holt",10,False,Holt,lambda v,_p,h:np.asarray(Holt(v,damped_trend=True,initialization_method="estimated").fit().forecast(h))),
        Adapter("holt_winters",seasonal_minimum,True,ExponentialSmoothing,lambda v,_p,h:np.asarray(ExponentialSmoothing(v,trend="add",damped_trend=True,seasonal="add",seasonal_periods=season,initialization_method="estimated").fit().forecast(h))),
        Adapter("arima",18,False,ARIMA,lambda v,_p,h:fit_arima(v,h)),
        Adapter("sarima",seasonal_minimum,True,SARIMAX,lambda v,_p,h:fit_sarima(v,h,season)),
        Adapter("prophet",seasonal_minimum,True,Prophet,lambda v,p,h:fit_prophet(v,p,h,frequency)),
        Adapter("seasonal_decomposition",seasonal_minimum,True,True,lambda v,_p,h:seasonal_additive(v,h,season)),
        Adapter("stl",seasonal_minimum,True,STL,lambda v,_p,h:fit_stl(v,h,season)),
        Adapter("random_forest",ml_minimum,False,RandomForestRegressor,ml(RandomForestRegressor,{"n_estimators":140,"min_samples_leaf":2,"random_state":42,"n_jobs":1}) if RandomForestRegressor else lambda *_:np.array([])),
        Adapter("gradient_boosting",ml_minimum,False,GradientBoostingRegressor,ml(GradientBoostingRegressor,{"n_estimators":100,"max_depth":2,"learning_rate":.04,"loss":"huber","random_state":42}) if GradientBoostingRegressor else lambda *_:np.array([])),
        Adapter("xgboost",max(48,ml_minimum),False,XGBRegressor,ml(XGBRegressor,{"n_estimators":120,"max_depth":3,"learning_rate":.04,"subsample":.8,"colsample_bytree":.8,"objective":"reg:squarederror","random_state":42,"n_jobs":1}) if XGBRegressor else lambda *_:np.array([])),
        Adapter("lightgbm",max(48,ml_minimum),False,LGBMRegressor,ml(LGBMRegressor,{"n_estimators":120,"max_depth":3,"learning_rate":.04,"verbosity":-1,"random_state":42,"n_jobs":1}) if LGBMRegressor else lambda *_:np.array([])),
        Adapter("catboost",max(48,ml_minimum),False,CatBoostRegressor,ml(CatBoostRegressor,{"iterations":120,"depth":4,"learning_rate":.04,"verbose":False,"random_seed":42,"thread_count":1}) if CatBoostRegressor else lambda *_:np.array([])),
        Adapter("lstm",deep_minimum,False,importlib.util.find_spec("tensorflow") is not None,lambda v,_p,h:fit_deep(v,h,season,"lstm")),
        Adapter("gru",deep_minimum,False,importlib.util.find_spec("tensorflow") is not None,lambda v,_p,h:fit_deep(v,h,season,"gru")),
    ]


def diagnose(values: np.ndarray, periods: list[str], season: int, regularity: float, context: dict[str,list[float|None]]) -> dict[str,Any]:
    x = np.arange(len(values),dtype=float)
    slope, intercept = np.polyfit(x,values,1)
    fitted = intercept+slope*x
    residuals = values-fitted
    variance = float(np.var(values))
    trend_strength = max(0.0,1-float(np.var(residuals))/variance) if variance>1e-12 else 0.0
    seasonal_strength = 0.0
    profile: list[dict[str,Any]] = []
    if len(values)>=season*2:
        seasonal_effects = np.asarray([float(np.mean(residuals[np.arange(len(values))%season==position])) for position in range(season)])
        repeated = np.asarray([seasonal_effects[index%season] for index in range(len(values))])
        seasonal_strength = max(0.0,1-float(np.var(residuals-repeated))/float(np.var(residuals))) if np.var(residuals)>1e-12 else 0.0
        profile = [{"position":position+1,"effect":clean(effect)} for position,effect in enumerate(seasonal_effects)]
    scale = float(np.std(residuals)) or 1.0
    anomalies = [{"period":periods[index],"value":clean(value),"zScore":clean((value-fitted[index])/scale)} for index,value in enumerate(values) if abs((value-fitted[index])/scale)>=2.75]
    correlations=[]
    for name,raw in context.items():
        paired=[(values[index],raw[index]) for index in range(min(len(values),len(raw))) if raw[index] is not None]
        if len(paired)>=6:
            left,right=np.asarray([p[0] for p in paired]),np.asarray([p[1] for p in paired])
            if np.std(right)>1e-12:
                correlations.append({"feature":name,"coefficient":clean(np.corrcoef(left,right)[0,1])})
    correlations.sort(key=lambda item:abs(item["coefficient"]),reverse=True)
    coefficient=float(np.std(values)/max(float(np.mean(np.abs(values))),1e-9))
    holiday_effects=[]
    if profile and season==12:
        for item in profile:
            if abs(item["effect"])>=scale*1.25:
                holiday_effects.append({"month":item["position"],"effect":item["effect"],"direction":"spike" if item["effect"]>0 else "dip","reason":"Repeatable calendar effect; event identity is not inferred."})
    growth=((float(values[-1])/float(values[0]))**(1/max(1,len(values)-1))-1)*100 if values[0]>0 and values[-1]>=0 else None
    return {
        "trend":{"detected":trend_strength>=.2,"direction":"growth" if slope>0 else "decline" if slope<0 else "stable","strength":clean(trend_strength),"slopePerPeriod":clean(slope)},
        "seasonality":{"detected":seasonal_strength>=.25 and regularity>=.8,"period":season if seasonal_strength>=.25 else None,"strength":clean(seasonal_strength),"profile":profile},
        "volatility":{"coefficient":clean(coefficient),"level":"high" if coefficient>=.35 else "medium" if coefficient>=.15 else "low"},
        "regularity":clean(regularity),"anomalies":anomalies[-20:],"correlations":correlations[:8],"holidayEffects":holiday_effects,
        "marketingImpact":[item for item in correlations if any(token in item["feature"].lower() for token in ("marketing","campaign","spend","ads","promotion"))][:3],
        "growthPattern":{"compoundRatePerPeriod":None if growth is None else clean(growth),"direction":"growth" if slope>0 else "decline" if slope<0 else "stable"},"cyclicBehavior":seasonal_strength>=.25,
    }


def size_class(count: int) -> str:
    return "very_small" if count<12 else "small" if count<36 else "medium" if count<=100 else "large"


def eligibility(adapter: Adapter, count: int, earliest_origin: int, diagnostics: dict[str,Any], full: bool) -> tuple[bool,str]:
    group=size_class(count)
    small_allowed={"linear_regression","multiple_linear_regression","moving_average","weighted_moving_average","exponential_smoothing","holt","holt_winters","arima","sarima","prophet","seasonal_decomposition","stl"}
    tiny_allowed={"linear_regression","moving_average","weighted_moving_average","exponential_smoothing"}
    if group=="very_small" and adapter.key not in tiny_allowed:
        return False,"Very small history (<12 periods); model complexity cannot be validated reliably."
    if group=="small" and adapter.key not in small_allowed:
        return False,"Small history (12–35 periods); machine/deep learning would have too few independent lag examples."
    if group=="medium" and adapter.key in ("lstm","gru"):
        return False,"Deep learning is restricted to histories longer than 100 periods with repeated temporal folds."
    if not full and adapter.key in ("prophet","xgboost","lightgbm","catboost","lstm","gru"):
        return False,"Compute-intensive challengers are reserved for the primary business metric; secondary metrics use efficient validated models."
    if adapter.dependency is None or adapter.dependency is False:
        return False,"Required scientific runtime is not installed."
    if earliest_origin<adapter.minimum:
        return False,f"The earliest common walk-forward training window has {earliest_origin} periods; this model requires at least {adapter.minimum}."
    if adapter.seasonal and not diagnostics["seasonality"]["detected"]:
        return False,"No stable recurring seasonality was detected on a sufficiently regular series."
    if diagnostics["regularity"]<.7 and adapter.key not in ("linear_regression","moving_average","weighted_moving_average"):
        return False,"Temporal spacing is too irregular for this model's equal-interval assumptions."
    return True,"Passed dataset-size, regularity, signal and common walk-forward eligibility checks."


def folds(count: int, horizon: int) -> tuple[int,list[int]]:
    validation_horizon=max(1,min(horizon,max(1,count//8)))
    desired=5 if count>100 else 4 if count>=36 else 3
    target_training=101 if count>100 else 36 if count>=48 else 12 if count>=18 else 6
    while desired>2 and count-validation_horizon*desired<target_training:
        desired-=1
    origins=[count-validation_horizon*step for step in range(desired,0,-1)]
    return validation_horizon,origins


def selection_score(result: dict[str,Any], baseline_rmse: float) -> float:
    m=result["metrics"]
    relative=float(m["rmse"])/max(baseline_rmse,1e-9)
    stability=min(float(result["stability"]),2.0)
    return clean(.72*relative+.18*stability+.10*(1-float(m["accuracyPercentage"])/100))


def basic_confidence(model_metrics: dict[str,Any], stability: float, completeness: float, count: int, season: int) -> float:
    error=100/(1+2*float(model_metrics["normalizedRmse"]))
    stable=100/(1+max(0.0,stability))
    history=min(100.0,count/max(24,season*2)*100)
    return clean(.45*error+.25*stable+.15*completeness+.15*history)


def model_record(adapter: Adapter,status: str,reason: str,result: dict[str,Any]|None=None) -> dict[str,Any]:
    name,family,advantage,limitation,requirements=MODEL_META[adapter.key]
    return {"key":adapter.key,"name":name,"family":family,"status":status,"reason":reason,"requiredCharacteristics":requirements,"advantages":advantage,"disadvantages":limitation,"trainingTimeMs":result.get("trainingTimeMs") if result else None,"metrics":result.get("metrics") if result else None,"confidence":result.get("confidence") if result else None,"selectionScore":result.get("selectionScore") if result else None,"stability":result.get("stability") if result else None,"forecast":result.get("forecast") if result else None,"foldMetrics":result.get("foldMetrics") if result else None}


def conformal_quantile(errors: np.ndarray, coverage: float=.95) -> float:
    if not len(errors):
        return 0.0
    ordered=np.sort(np.abs(errors))
    rank=min(len(ordered)-1,max(0,math.ceil((len(ordered)+1)*coverage)-1))
    return float(ordered[rank])


def transparent_confidence(metrics_: dict[str,Any], interval_width: float, scale: float, completeness: float, count: int, season: int, stability: float, seasonal_strength: float, regularity: float, agreement: float, horizon: int, anomaly_rate: float) -> dict[str,Any]:
    components={
        "forecastError":100/(1+2*float(metrics_["normalizedRmse"])),
        "intervalPrecision":100/(1+4*interval_width/max(scale,1e-9)),
        "datasetCompleteness":completeness,
        "historySufficiency":min(100.0,count/max(24,season*2)*100),
        "modelStability":100/(1+max(0.0,stability)),
        "seasonalConsistency":100*seasonal_strength*regularity if seasonal_strength>=.25 else 80*regularity,
        "ensembleAgreement":agreement,
        "dataQuality":completeness*regularity*max(.5,1-anomaly_rate),
        "horizonDifficulty":100*math.exp(-horizon/max(season*2,6)),
    }
    weights={"forecastError":.25,"intervalPrecision":.15,"datasetCompleteness":.10,"historySufficiency":.10,"modelStability":.15,"seasonalConsistency":.08,"ensembleAgreement":.07,"dataQuality":.05,"horizonDifficulty":.05}
    score=sum(components[key]*weights[key] for key in weights)
    return {"score":clean(max(0,min(98,score))),"components":{key:clean(value) for key,value in components.items()},"weights":weights,"methodology":"Weighted reproducible score from walk-forward error, conformal interval width, completeness, history, fold stability, seasonal consistency, challenger agreement, data quality and horizon difficulty."}


def run_metric(metric: str,column: str,observations: list[dict[str,Any]],context: dict[str,list[float|None]],horizon: int,completeness: float,full: bool,requested_frequency: str|None) -> dict[str,Any]|None:
    if len(observations)<6:
        return None
    periods=[item["period"] for item in observations]
    values=np.asarray([item["value"] for item in observations],dtype=float)
    frequency,season,regularity=infer_frequency(periods,requested_frequency)
    diagnostics=diagnose(values,periods,season,regularity,context)
    validation_horizon,origins=folds(len(values),horizon)
    actual=np.concatenate([values[origin:origin+validation_horizon] for origin in origins])
    naive=np.concatenate([np.repeat(values[origin-1],validation_horizon) for origin in origins])
    baseline_metrics=metric_values(actual,naive,values[:origins[0]])
    baseline_rmse=max(float(baseline_metrics["rmse"]),1e-9)
    registry,evaluated=[],[]
    validation_contract={"method":"expanding-window walk-forward","folds":len(origins),"horizon":validation_horizon,"origins":origins,"randomSplit":False}
    for adapter in adapters(season,frequency):
        allowed,reason=eligibility(adapter,len(values),origins[0],diagnostics,full)
        if not allowed:
            status="unavailable" if "runtime" in reason else "rejected"
            registry.append(model_record(adapter,status,reason))
            continue
        started=time.perf_counter()
        try:
            predictions=[]
            residual_steps=[[] for _ in range(validation_horizon)]
            fold_metrics=[]
            for origin in origins:
                predicted=np.asarray(adapter.fit(values[:origin],periods[:origin],validation_horizon),dtype=float)
                expected=values[origin:origin+validation_horizon]
                if len(predicted)!=len(expected) or not np.all(np.isfinite(predicted)):
                    raise RuntimeError("Invalid walk-forward predictions.")
                predictions.extend(predicted)
                for step,error in enumerate(predicted-expected):
                    residual_steps[step].append(float(error))
                fold_metrics.append(metric_values(expected,predicted,values[:origin]))
            predicted_all=np.asarray(predictions)
            final=np.asarray(adapter.fit(values,periods,horizon),dtype=float)
            if len(final)!=horizon or not np.all(np.isfinite(final)):
                raise RuntimeError("Invalid final forecast.")
            if np.all(values>=0):
                final=np.maximum(final,0)
            model_metrics=metric_values(actual,predicted_all,values[:origins[0]])
            fold_rmse=np.asarray([item["rmse"] for item in fold_metrics],dtype=float)
            stability=float(np.std(fold_rmse)/(np.mean(fold_rmse)+1e-9))
            result={"metrics":model_metrics,"stability":clean(stability),"forecast":[clean(value) for value in final],"predictions":predicted_all,"residuals":predicted_all-actual,"residualSteps":residual_steps,"foldMetrics":fold_metrics,"trainingTimeMs":clean((time.perf_counter()-started)*1000)}
            result["selectionScore"]=selection_score(result,baseline_rmse)
            result["confidence"]=basic_confidence(model_metrics,stability,completeness,len(values),season)
            evaluated.append({"adapter":adapter,"result":result})
            registry.append(model_record(adapter,"evaluated",reason,result))
        except Exception as error:
            registry.append(model_record(adapter,"failed",str(error)[:240]))
    if not evaluated:
        raise RuntimeError(f"No eligible model completed for {metric}.")
    evaluated.sort(key=lambda item:item["result"]["selectionScore"])
    winner=evaluated[0]
    chosen=winner
    strategy_type="single"
    weights=[{"model":winner["adapter"].key,"weight":1.0}]
    reason=f"{MODEL_META[winner['adapter'].key][0]} achieved the best objective score across identical expanding-window folds."
    candidates=evaluated[:min(3,len(evaluated))]
    if len(candidates)>=2 and len(values)>100:
        inverse=np.asarray([1/max(float(item["result"]["metrics"]["rmse"])**2,1e-9) for item in candidates])
        ensemble_weights=inverse/np.sum(inverse)
        ensemble_predictions=np.sum(np.asarray([item["result"]["predictions"] for item in candidates])*ensemble_weights[:,None],axis=0)
        ensemble_future=np.sum(np.asarray([item["result"]["forecast"] for item in candidates])*ensemble_weights[:,None],axis=0)
        ensemble_metrics=metric_values(actual,ensemble_predictions,values[:origins[0]])
        fold_size=validation_horizon
        fold_rmse=[metric_values(actual[index:index+fold_size],ensemble_predictions[index:index+fold_size],values[:origins[0]])["rmse"] for index in range(0,len(actual),fold_size)]
        ensemble_stability=float(np.std(fold_rmse)/(np.mean(fold_rmse)+1e-9))
        ensemble_result={"metrics":ensemble_metrics,"stability":clean(ensemble_stability),"forecast":ensemble_future,"predictions":ensemble_predictions,"residuals":ensemble_predictions-actual,"residualSteps":[list((ensemble_predictions-actual)[step::validation_horizon]) for step in range(validation_horizon)]}
        ensemble_result["selectionScore"]=selection_score(ensemble_result,baseline_rmse)
        if float(ensemble_metrics["rmse"])<float(winner["result"]["metrics"]["rmse"])*.99 and float(ensemble_result["selectionScore"])<float(winner["result"]["selectionScore"]):
            chosen={"adapter":None,"result":ensemble_result}
            strategy_type="ensemble"
            weights=[{"model":item["adapter"].key,"weight":clean(weight)} for item,weight in zip(candidates,ensemble_weights)]
            reason="The weighted ensemble was accepted only after reducing walk-forward RMSE by at least 1% and improving the objective stability score versus the best single model."
    selected_result=chosen["result"]
    selected_keys=[item["model"] for item in weights]
    selected_name=" + ".join(MODEL_META[key][0] for key in selected_keys)
    residuals=np.asarray(selected_result["residuals"],dtype=float)
    pooled=conformal_quantile(residuals,.95)
    value_scale=max(float(np.mean(np.abs(values))),1e-9)
    volatility=float(np.std(np.diff(values))) if len(values)>2 else float(np.std(values))
    forecast=np.asarray(selected_result["forecast"],dtype=float)
    periods_out=future_periods(periods[-1],horizon,frequency)
    points=[]
    widths=[]
    for index,value in enumerate(forecast):
        step_errors=np.asarray(selected_result["residualSteps"][min(index,validation_horizon-1)],dtype=float)
        specific=conformal_quantile(step_errors,.95) if len(step_errors)>=5 else pooled*math.sqrt(1+index*.15)
        margin=max(specific,volatility*.20*math.sqrt(index+1),value_scale*.005)
        lower=value-margin
        if np.all(values>=0): lower=max(0,lower)
        widths.append(2*margin)
        points.append({"period":periods_out[index],"value":clean(value),"lower":clean(lower),"upper":clean(value+margin)})
    challenger_forecasts=np.asarray([item["result"]["forecast"] for item in candidates],dtype=float)
    agreement=100*math.exp(-4*float(np.mean(np.std(challenger_forecasts,axis=0)))/value_scale) if len(candidates)>1 else 75.0
    confidence=transparent_confidence(selected_result["metrics"],float(np.mean(widths)),value_scale,completeness,len(values),season,float(selected_result["stability"]),float(diagnostics["seasonality"]["strength"]),regularity,agreement,horizon,len(diagnostics["anomalies"])/len(values))
    change=(float(forecast[-1])-float(values[-1]))/abs(float(values[-1]))*100 if abs(float(values[-1]))>1e-9 else None
    return {"metric":metric,"column":column,"frequency":frequency,"trainingPeriods":len(values),"validationPeriods":len(actual),"validation":validation_contract,"diagnostics":diagnostics,"models":registry,"strategy":{"type":strategy_type,"selectedModels":selected_keys,"selectedName":selected_name,"weights":weights,"reason":reason,"confidence":confidence["score"],"confidenceMethodology":confidence,"accuracyPercentage":selected_result["metrics"]["accuracyPercentage"],"metrics":selected_result["metrics"],"intervalMethod":"95% finite-sample conformal interval from selected-strategy walk-forward residuals, widened by horizon and observed volatility","confidenceLevel":95},"changePercent":None if change is None else clean(change),"points":points}


def main() -> None:
    request=json.load(sys.stdin)
    horizon=max(1,min(int(request.get("horizon",6)),60))
    series=request.get("series",[])
    columns=request.get("columns",{})
    completeness=float(request.get("completeness",0))
    requested_primary=request.get("primaryMetric")
    requested_frequency=request.get("frequency")
    context_series=request.get("contextSeries",[])
    context_by_period={point.get("period"):point.get("values",{}) for point in context_series if isinstance(point,dict)}
    available=[metric for metric in ("revenue","demand","profit","cost","inventory","kpi") if columns.get(metric)]
    primary=requested_primary if requested_primary in available else (available[0] if available else None)
    results={}
    for metric in ("revenue","demand","cost","inventory","profit","kpi"):
        observations=[{"period":point["period"],"value":float(point[metric])} for point in series if point.get(metric) is not None and isinstance(point.get("period"),str)]
        period_map={point.get("period"):point for point in series}
        names=set(key for point in series for key in point if key not in ("period",metric))
        names.update(key for values in context_by_period.values() if isinstance(values,dict) for key in values)
        context={name:[float(period_map.get(item["period"],{}).get(name) if period_map.get(item["period"],{}).get(name) is not None else context_by_period.get(item["period"],{}).get(name)) if isinstance(period_map.get(item["period"],{}).get(name) if period_map.get(item["period"],{}).get(name) is not None else context_by_period.get(item["period"],{}).get(name),(int,float)) else None for item in observations] for name in names}
        results[metric]=run_metric(metric,columns.get(metric,metric),observations,context,horizon,completeness,metric==primary,requested_frequency) if columns.get(metric) else None
    forecastable=[key for key,value in results.items() if value]
    dataset_type="retail_or_ecommerce" if all(key in forecastable for key in ("revenue","demand","inventory")) else "financial" if all(key in forecastable for key in ("revenue","cost")) else "demand" if "demand" in forecastable else "business_kpi"
    frequencies=[value["frequency"] for value in results.values() if value]
    print(json.dumps({"version":"2.0","engine":"Forecast Intelligence Engine","datasetProfile":{"type":dataset_type,"problem":"multivariate_time_series" if len(forecastable)>1 else "univariate_time_series","frequency":frequencies[0] if frequencies else requested_frequency or "unknown","forecastableMetrics":forecastable},"forecasts":results},separators=(",",":")))


if __name__=="__main__":
    main()

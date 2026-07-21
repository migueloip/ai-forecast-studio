import unittest

import numpy as np

import engine


class ForecastEngineV2Tests(unittest.TestCase):
    def test_frequency_detection_supports_daily_weekly_monthly_and_quarterly(self):
        daily = [f"2026-01-{day:02d}" for day in range(1, 10)]
        weekly = ["2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26"]
        monthly = ["2025-10", "2025-11", "2025-12", "2026-01"]
        quarterly = ["2025-01", "2025-04", "2025-07", "2025-10"]
        self.assertEqual(engine.infer_frequency(daily)[0], "daily")
        self.assertEqual(engine.infer_frequency(weekly)[0], "weekly")
        self.assertEqual(engine.infer_frequency(monthly)[0], "monthly")
        self.assertEqual(engine.infer_frequency(quarterly)[0], "quarterly")
        self.assertEqual(engine.future_periods("2025-10", 2, "quarterly"), ["2026-01", "2026-04"])

    def test_short_history_uses_common_walk_forward_and_rejects_complexity(self):
        observations = [{"period": f"2025-{month:02d}", "value": 100 + month * 5} for month in range(1, 11)]
        result = engine.run_metric("revenue", "revenue", observations, {}, 3, 100, True, "monthly")
        self.assertIsNotNone(result)
        self.assertFalse(result["validation"]["randomSplit"])
        self.assertGreaterEqual(result["validation"]["folds"], 2)
        statuses = {model["key"]: model for model in result["models"]}
        self.assertEqual(statuses["linear_regression"]["status"], "evaluated")
        self.assertEqual(statuses["xgboost"]["status"], "rejected")
        self.assertIn("requiredCharacteristics", statuses["xgboost"])

    def test_confidence_is_reproducible_and_intervals_contain_point_forecasts(self):
        values = np.asarray([1_000 + index * 100 for index in range(18)], dtype=float)
        observations = [{"period": engine.future_periods("2023-12", index + 1, "monthly")[-1], "value": value} for index, value in enumerate(values)]
        result = engine.run_metric("revenue", "revenue", observations, {}, 6, 96, True, "monthly")
        methodology = result["strategy"]["confidenceMethodology"]
        self.assertAlmostEqual(sum(methodology["weights"].values()), 1.0)
        recomputed = sum(methodology["components"][key] * weight for key, weight in methodology["weights"].items())
        self.assertAlmostEqual(result["strategy"]["confidence"], recomputed, places=5)
        self.assertTrue(all(point["lower"] <= point["value"] <= point["upper"] for point in result["points"]))


if __name__ == "__main__":
    unittest.main()

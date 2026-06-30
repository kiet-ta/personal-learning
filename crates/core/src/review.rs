use std::fmt;
use std::str::FromStr;

// ── Constants ────────────────────────────────────────────────────────────────

/// Default ease factor for new review items.
pub const DEFAULT_EASE: f64 = 2.5;

/// Minimum allowed ease factor.
pub const MIN_EASE: f64 = 1.3;

/// Maximum allowed interval in days.
pub const MAX_INTERVAL_DAYS: f64 = 365.0;

// ── Errors ──────────────────────────────────────────────────────────────────

/// Errors that can occur during review operations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReviewError {
    /// The grade string could not be parsed.
    InvalidGrade(String),
}

impl fmt::Display for ReviewError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ReviewError::InvalidGrade(s) => write!(f, "invalid review grade: '{s}'"),
        }
    }
}

impl std::error::Error for ReviewError {}

// ── ReviewGrade ──────────────────────────────────────────────────────────────

/// A grade given when reviewing a flashcard/item.
///
/// Discriminant values match common spaced-repetition conventions:
/// - `Again` = 0  (complete failure)
/// - `Hard`  = 1  (recalled with difficulty)
/// - `Good`  = 2  (recalled correctly)
/// - `Easy`  = 3  (recalled effortlessly)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ReviewGrade {
    Again = 0,
    Hard = 1,
    Good = 2,
    Easy = 3,
}

impl ReviewGrade {
    /// Return the string representation (lowercase).
    pub fn as_str(&self) -> &'static str {
        match self {
            ReviewGrade::Again => "again",
            ReviewGrade::Hard => "hard",
            ReviewGrade::Good => "good",
            ReviewGrade::Easy => "easy",
        }
    }
}

impl FromStr for ReviewGrade {
    type Err = ReviewError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_lowercase().as_str() {
            "again" | "0" => Ok(ReviewGrade::Again),
            "hard" | "1" => Ok(ReviewGrade::Hard),
            "good" | "2" => Ok(ReviewGrade::Good),
            "easy" | "3" => Ok(ReviewGrade::Easy),
            _ => Err(ReviewError::InvalidGrade(s.to_string())),
        }
    }
}

impl fmt::Display for ReviewGrade {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

// ── ReviewItem ───────────────────────────────────────────────────────────────

/// A single item scheduled for review (or already in the review queue).
#[derive(Debug, Clone, PartialEq)]
pub struct ReviewItem {
    /// Unique identifier for this review item.
    pub item_id: String,
    /// The knowledge-node this item tests.
    pub node_id: String,
    /// The question / prompt shown to the learner.
    pub prompt: String,
    /// Unix timestamp (milliseconds) at which this item becomes due.
    pub due_at_unix_ms: i64,
    /// Current inter-repetition interval in days.
    pub interval_days: f64,
    /// Current ease factor (minimum `MIN_EASE`).
    pub ease_factor: f64,
    /// Number of successful reviews so far.
    pub repetitions: u32,
}

// ── ReviewEvent ──────────────────────────────────────────────────────────────

/// A record of a single review action performed by the learner.
#[derive(Debug, Clone, PartialEq)]
pub struct ReviewEvent {
    /// Unique identifier for this event.
    pub event_id: String,
    /// The item that was reviewed.
    pub item_id: String,
    /// Grade the learner assigned.
    pub grade: ReviewGrade,
    /// Time spent answering, in milliseconds.
    pub latency_ms: u32,
    /// Unix timestamp (milliseconds) when the review occurred.
    pub reviewed_at_unix_ms: i64,
}

// ── ReviewScheduler ──────────────────────────────────────────────────────────

/// Implements a simplified FSRS v3 spaced-repetition scheduler.
///
/// All scheduling logic is exposed via the static method
/// [`next_interval`](ReviewScheduler::next_interval).
pub struct ReviewScheduler;

impl ReviewScheduler {
    /// Compute the next scheduling parameters based on the learner's grade.
    ///
    /// # Parameters
    ///
    /// * `current_interval_days` – the interval that was used for *this* review.
    /// * `current_ease_factor`   – the ease factor before this review.
    /// * `repetitions`           – number of successful reviews before this one.
    /// * `grade`                 – the grade the learner just gave.
    ///
    /// # Returns
    ///
    /// `(new_interval_days, new_ease_factor, new_repetitions)`
    ///
    /// # Algorithm (simplified FSRS v3)
    ///
    /// | Grade   | Interval                                     | Ease adjustment       | Reps     |
    /// |---------|----------------------------------------------|-----------------------|----------|
    /// | Again   | 1 day                                        | ease -= 0.20          | reset to 0 |
    /// | Hard    | interval × 1.2                               | ease -= 0.15          | reps + 1 |
    /// | Good    | reps==0 → 1 day else interval × ease         | unchanged             | reps + 1 |
    /// | Easy    | reps==0 → 2 days else interval × ease × 1.3  | ease += 0.15          | reps + 1 |
    pub fn next_interval(
        current_interval_days: f64,
        current_ease_factor: f64,
        repetitions: u32,
        grade: ReviewGrade,
    ) -> (f64, f64, u32) {
        let (new_interval, ease_delta, new_reps) = match grade {
            ReviewGrade::Again => (1.0, -0.20, 0u32),
            ReviewGrade::Hard => {
                let interval = (current_interval_days * 1.2).min(MAX_INTERVAL_DAYS);
                (interval, -0.15, repetitions + 1)
            }
            ReviewGrade::Good => {
                let interval = if repetitions == 0 {
                    1.0
                } else {
                    (current_interval_days * current_ease_factor).min(MAX_INTERVAL_DAYS)
                };
                (interval, 0.0, repetitions + 1)
            }
            ReviewGrade::Easy => {
                let interval = if repetitions == 0 {
                    2.0
                } else {
                    (current_interval_days * current_ease_factor * 1.3).min(MAX_INTERVAL_DAYS)
                };
                (interval, 0.15, repetitions + 1)
            }
        };

        // Clamp ease factor
        let new_ease = (current_ease_factor + ease_delta).max(MIN_EASE);

        // Clamp interval
        let new_interval = new_interval.max(1.0).min(MAX_INTERVAL_DAYS);

        (new_interval, new_ease, new_reps)
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Compute the due timestamp (in milliseconds since Unix epoch) for an item
/// whose interval is `interval_days`.
///
/// The timestamp is calculated as `now + interval_days` in milliseconds.
/// If you need a deterministic value for testing, mock the clock by passing
/// an explicit `now_ms` via [`due_timestamp_at`].
pub fn due_timestamp(interval_days: f64) -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    due_timestamp_at(interval_days, now_ms)
}

/// Compute the due timestamp relative to an explicit reference time.
///
/// Useful for deterministic tests.
pub fn due_timestamp_at(interval_days: f64, now_ms: i64) -> i64 {
    let interval_ms = (interval_days * 24.0 * 60.0 * 60.0 * 1000.0) as i64;
    now_ms
        .checked_add(interval_ms)
        .unwrap_or(i64::MAX)
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── ReviewGrade ──────────────────────────────────────────────────────

    #[test]
    fn test_grade_as_str() {
        assert_eq!(ReviewGrade::Again.as_str(), "again");
        assert_eq!(ReviewGrade::Hard.as_str(), "hard");
        assert_eq!(ReviewGrade::Good.as_str(), "good");
        assert_eq!(ReviewGrade::Easy.as_str(), "easy");
    }

    #[test]
    fn test_grade_from_str_lowercase() {
        assert_eq!("again".parse::<ReviewGrade>().unwrap(), ReviewGrade::Again);
        assert_eq!("hard".parse::<ReviewGrade>().unwrap(), ReviewGrade::Hard);
        assert_eq!("good".parse::<ReviewGrade>().unwrap(), ReviewGrade::Good);
        assert_eq!("easy".parse::<ReviewGrade>().unwrap(), ReviewGrade::Easy);
    }

    #[test]
    fn test_grade_from_str_mixed_case() {
        assert_eq!("Again".parse::<ReviewGrade>().unwrap(), ReviewGrade::Again);
        assert_eq!("HARD".parse::<ReviewGrade>().unwrap(), ReviewGrade::Hard);
        assert_eq!("GoOd".parse::<ReviewGrade>().unwrap(), ReviewGrade::Good);
        assert_eq!("EASY".parse::<ReviewGrade>().unwrap(), ReviewGrade::Easy);
    }

    #[test]
    fn test_grade_from_str_numeric() {
        assert_eq!("0".parse::<ReviewGrade>().unwrap(), ReviewGrade::Again);
        assert_eq!("1".parse::<ReviewGrade>().unwrap(), ReviewGrade::Hard);
        assert_eq!("2".parse::<ReviewGrade>().unwrap(), ReviewGrade::Good);
        assert_eq!("3".parse::<ReviewGrade>().unwrap(), ReviewGrade::Easy);
    }

    #[test]
    fn test_grade_from_str_invalid() {
        let err = "invalid".parse::<ReviewGrade>().unwrap_err();
        assert!(matches!(err, ReviewError::InvalidGrade(_)));
        assert_eq!(
            err.to_string(),
            "invalid review grade: 'invalid'"
        );
    }

    #[test]
    fn test_grade_display() {
        assert_eq!(format!("{}", ReviewGrade::Again), "again");
        assert_eq!(format!("{}", ReviewGrade::Hard), "hard");
        assert_eq!(format!("{}", ReviewGrade::Good), "good");
        assert_eq!(format!("{}", ReviewGrade::Easy), "easy");
    }

    #[test]
    fn test_grade_discriminant_values() {
        assert_eq!(ReviewGrade::Again as i32, 0);
        assert_eq!(ReviewGrade::Hard as i32, 1);
        assert_eq!(ReviewGrade::Good as i32, 2);
        assert_eq!(ReviewGrade::Easy as i32, 3);
    }

    // ── ReviewItem ───────────────────────────────────────────────────────

    #[test]
    fn test_review_item_fields() {
        let item = ReviewItem {
            item_id: "item-1".into(),
            node_id: "node-42".into(),
            prompt: "What is the capital of France?".into(),
            due_at_unix_ms: 1_700_000_000_000,
            interval_days: 1.0,
            ease_factor: 2.5,
            repetitions: 0,
        };
        assert_eq!(item.item_id, "item-1");
        assert_eq!(item.node_id, "node-42");
        assert_eq!(item.prompt, "What is the capital of France?");
        assert_eq!(item.due_at_unix_ms, 1_700_000_000_000);
        assert_eq!(item.interval_days, 1.0);
        assert_eq!(item.ease_factor, 2.5);
        assert_eq!(item.repetitions, 0);
    }

    // ── ReviewEvent ──────────────────────────────────────────────────────

    #[test]
    fn test_review_event_fields() {
        let event = ReviewEvent {
            event_id: "evt-1".into(),
            item_id: "item-1".into(),
            grade: ReviewGrade::Good,
            latency_ms: 3_200,
            reviewed_at_unix_ms: 1_700_001_000_000,
        };
        assert_eq!(event.event_id, "evt-1");
        assert_eq!(event.item_id, "item-1");
        assert_eq!(event.grade, ReviewGrade::Good);
        assert_eq!(event.latency_ms, 3_200);
        assert_eq!(event.reviewed_at_unix_ms, 1_700_001_000_000);
    }

    // ── Constants ────────────────────────────────────────────────────────

    #[test]
    fn test_constants() {
        assert_eq!(DEFAULT_EASE, 2.5);
        assert_eq!(MIN_EASE, 1.3);
        assert_eq!(MAX_INTERVAL_DAYS, 365.0);
    }

    // ── ReviewScheduler::next_interval ───────────────────────────────────

    /// Helper: assert that scheduling results are approximately equal.
    fn assert_scheduling(
        actual: (f64, f64, u32),
        expected_interval: f64,
        expected_ease: f64,
        expected_reps: u32,
    ) {
        let (interval, ease, reps) = actual;
        assert!(
            (interval - expected_interval).abs() < 1e-9,
            "interval mismatch: got {interval}, expected {expected_interval}"
        );
        assert!(
            (ease - expected_ease).abs() < 1e-9,
            "ease mismatch: got {ease}, expected {expected_ease}"
        );
        assert_eq!(reps, expected_reps, "repetitions mismatch");
    }

    // ── Again ────────────────────────────────────────────────────────────

    #[test]
    fn test_again_new_item() {
        // A brand-new item (reps=0) answered "Again"
        let result = ReviewScheduler::next_interval(0.0, 2.5, 0, ReviewGrade::Again);
        assert_scheduling(result, 1.0, 2.3, 0);
    }

    #[test]
    fn test_again_after_several_reviews() {
        // An item with some history answered "Again"
        let result = ReviewScheduler::next_interval(10.0, 2.5, 5, ReviewGrade::Again);
        assert_scheduling(result, 1.0, 2.3, 0);
    }

    #[test]
    fn test_again_ease_clamped_to_min() {
        // Ease starts at MIN_EASE; Again should not drop below MIN_EASE
        let result = ReviewScheduler::next_interval(5.0, 1.3, 3, ReviewGrade::Again);
        assert_scheduling(result, 1.0, 1.3, 0);
    }

    // ── Hard ─────────────────────────────────────────────────────────────

    #[test]
    fn test_hard_new_item() {
        // New item answered "Hard": interval = 0 * 1.2 = 0 → clamped to 1.0
        let result = ReviewScheduler::next_interval(0.0, 2.5, 0, ReviewGrade::Hard);
        assert_scheduling(result, 1.0, 2.35, 1);
    }

    #[test]
    fn test_hard_existing_item() {
        let result = ReviewScheduler::next_interval(10.0, 2.5, 3, ReviewGrade::Hard);
        assert_scheduling(result, 12.0, 2.35, 4);
    }

    #[test]
    fn test_hard_ease_clamped_to_min() {
        let result = ReviewScheduler::next_interval(5.0, 1.3, 2, ReviewGrade::Hard);
        assert_scheduling(result, 6.0, 1.3, 3); // ease would be 1.15, clamped to 1.3
    }

    #[test]
    fn test_hard_interval_capped() {
        let result = ReviewScheduler::next_interval(350.0, 2.5, 10, ReviewGrade::Hard);
        assert_scheduling(result, 365.0, 2.35, 11); // 350*1.2=420 > 365
    }

    // ── Good ─────────────────────────────────────────────────────────────

    #[test]
    fn test_good_first_review() {
        // reps == 0 → interval = 1 day
        let result = ReviewScheduler::next_interval(0.0, 2.5, 0, ReviewGrade::Good);
        assert_scheduling(result, 1.0, 2.5, 1);
    }

    #[test]
    fn test_good_subsequent_review() {
        // reps > 0 → interval *= ease
        let result = ReviewScheduler::next_interval(10.0, 2.5, 3, ReviewGrade::Good);
        assert_scheduling(result, 25.0, 2.5, 4);
    }

    #[test]
    fn test_good_interval_capped() {
        let result = ReviewScheduler::next_interval(200.0, 2.5, 5, ReviewGrade::Good);
        assert_scheduling(result, 365.0, 2.5, 6); // 200*2.5=500 > 365
    }

    // ── Easy ─────────────────────────────────────────────────────────────

    #[test]
    fn test_easy_first_review() {
        // reps == 0 → interval = 2 days
        let result = ReviewScheduler::next_interval(0.0, 2.5, 0, ReviewGrade::Easy);
        assert_scheduling(result, 2.0, 2.65, 1);
    }

    #[test]
    fn test_easy_subsequent_review() {
        // reps > 0 → interval *= ease * 1.3
        let result = ReviewScheduler::next_interval(10.0, 2.5, 3, ReviewGrade::Easy);
        assert_scheduling(result, 32.5, 2.65, 4); // 10 * 2.5 * 1.3 = 32.5
    }

    #[test]
    fn test_easy_interval_capped() {
        let result = ReviewScheduler::next_interval(200.0, 2.5, 5, ReviewGrade::Easy);
        assert_scheduling(result, 365.0, 2.65, 6); // 200*2.5*1.3=650 > 365
    }

    // ── Integration-style scenarios ──────────────────────────────────────

    #[test]
    fn test_learning_curve_scenario() {
        // Simulate a typical learning curve:
        // Day 0: new item, answer Good → interval=1, ease=2.5, reps=1
        let (mut interval, mut ease, mut reps) =
            ReviewScheduler::next_interval(0.0, 2.5, 0, ReviewGrade::Good);
        assert_scheduling((interval, ease, reps), 1.0, 2.5, 1);

        // Day 1: answer Good → interval=1*2.5=2.5, ease=2.5, reps=2
        (interval, ease, reps) =
            ReviewScheduler::next_interval(interval, ease, reps, ReviewGrade::Good);
        assert_scheduling((interval, ease, reps), 2.5, 2.5, 2);

        // Day 3.5: answer Good → interval=2.5*2.5=6.25, ease=2.5, reps=3
        (interval, ease, reps) =
            ReviewScheduler::next_interval(interval, ease, reps, ReviewGrade::Good);
        assert_scheduling((interval, ease, reps), 6.25, 2.5, 3);

        // Day ~10: answer Hard → interval=6.25*1.2=7.5, ease=2.35, reps=4
        (interval, ease, reps) =
            ReviewScheduler::next_interval(interval, ease, reps, ReviewGrade::Hard);
        assert_scheduling((interval, ease, reps), 7.5, 2.35, 4);

        // Day ~17.5: answer Easy → interval=7.5*2.35*1.3≈22.9125, ease=2.5, reps=5
        (interval, ease, reps) =
            ReviewScheduler::next_interval(interval, ease, reps, ReviewGrade::Easy);
        assert_scheduling((interval, ease, reps), 22.9125, 2.5, 5);

        // Day ~40.4: answer Again → interval=1, ease=2.3, reps=0 (reset!)
        (interval, ease, reps) =
            ReviewScheduler::next_interval(interval, ease, reps, ReviewGrade::Again);
        assert_scheduling((interval, ease, reps), 1.0, 2.3, 0);
    }

    // ── due_timestamp helpers ────────────────────────────────────────────

    #[test]
    fn test_due_timestamp_at_zero_interval() {
        let ts = due_timestamp_at(0.0, 1_700_000_000_000);
        assert_eq!(ts, 1_700_000_000_000);
    }

    #[test]
    fn test_due_timestamp_at_one_day() {
        let ts = due_timestamp_at(1.0, 1_700_000_000_000);
        // 1 day = 86_400_000 ms
        assert_eq!(ts, 1_700_086_400_000);
    }

    #[test]
    fn test_due_timestamp_at_fractional_day() {
        let ts = due_timestamp_at(0.5, 1_700_000_000_000);
        // 0.5 days = 43_200_000 ms
        assert_eq!(ts, 1_700_043_200_000);
    }

    #[test]
    fn test_due_timestamp_at_max_interval() {
        let ts = due_timestamp_at(365.0, 1_700_000_000_000);
        // 365 days = 365 * 86_400_000 = 31_536_000_000 ms
        assert_eq!(ts, 1_731_536_000_000);
    }

    #[test]
    fn test_due_timestamp_at_overflow_saturates() {
        // near i64::MAX should not panic
        let ts = due_timestamp_at(1.0, i64::MAX - 1);
        assert_eq!(ts, i64::MAX);
    }

    #[test]
    fn test_due_timestamp_is_positive() {
        // Realistic usage should produce a positive timestamp
        let ts = due_timestamp(1.0);
        assert!(ts > 1_700_000_000_000); // well past 2023
    }
}

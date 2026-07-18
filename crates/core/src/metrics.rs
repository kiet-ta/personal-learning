//! Transparent learning metrics (Slice 4).
//!
//! Per `plan.md`, the UI must show learning metrics derived from the
//! append-only `Learning Event` log written by every Review Run. This
//! module provides deterministic summaries with **transparent thresholds**
//! so the user can audit exactly which numbers feed the dashboard.
//!
//! Inputs:
//! - `LearningEvent` JSONL written by `review_runs.rs` (`review_completed`).
//!
//! Outputs (`LearningMetrics`):
//! - total review runs
//! - total cited source versions
//! - per-project aggregates (runs, due_count sum, max due_count, last_run_unix_ms)
//! - transparent thresholds used to derive the headline numbers
//!
//! No LLM, no clock math beyond `created_at_unix_ms` math already on
//! disk, no network. The vault is still the source of truth.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::review_runs::LearningEvent;

/// The transparent thresholds applied to the Learning Event stream.
///
/// Every number that surfaces in the UI maps back to a threshold in this
/// struct. We pass the struct straight to the UI so thresholds are not
/// a hidden implementation detail.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MetricsThresholds {
    /// Minimum number of completed runs before any "active learner" badge
    /// is shown. Default: 1. The threshold is reported so users can audit.
    pub active_learner_min_runs: u32,
    /// Multiplier applied to runs in the last 14 days to classify
    /// "consistency". Default: 1.0 (any run counts).
    pub consistency_window_ms: i64,
}

impl Default for MetricsThresholds {
    fn default() -> Self {
        Self {
            active_learner_min_runs: 1,
            consistency_window_ms: 14 * 24 * 60 * 60 * 1000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMetrics {
    pub project_id: String,
    pub run_count: u32,
    pub due_count_total: u32,
    pub due_count_max: u32,
    pub last_run_unix_ms: i64,
    pub cited_source_version_total: u32,
    /// True when this project clears `active_learner_min_runs`.
    pub is_active_learner: bool,
    /// Number of runs inside the consistency window.
    pub recent_run_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LearningMetrics {
    pub schema_version: u32,
    pub thresholds: MetricsThresholds,
    pub total_runs: u32,
    pub total_cited_source_versions: u32,
    pub projects: Vec<ProjectMetrics>,
    /// Earliest event timestamp encountered, 0 if no events.
    pub first_event_unix_ms: i64,
    /// Latest event timestamp encountered, 0 if no events.
    pub last_event_unix_ms: i64,
}

pub const METRICS_SCHEMA_VERSION: u32 = 1;

pub fn derive_learning_metrics(
    events: &[LearningEvent],
    thresholds: &MetricsThresholds,
    now_unix_ms: i64,
) -> LearningMetrics {
    let mut per_project: BTreeMap<String, ProjectAggregate> = BTreeMap::new();
    let mut first_event = 0i64;
    let mut last_event = 0i64;

    for event in events {
        let entry = per_project
            .entry(event.project_id.clone())
            .or_insert_with(ProjectAggregate::default);
        entry.run_count += 1;
        entry.due_count_total = entry.due_count_total.saturating_add(event.due_count);
        if event.due_count > entry.due_count_max {
            entry.due_count_max = event.due_count;
        }
        if event.created_at_unix_ms > entry.last_run_unix_ms {
            entry.last_run_unix_ms = event.created_at_unix_ms;
        }
        entry.cited_source_version_total = entry
            .cited_source_version_total
            .saturating_add(event.cited_source_version_ids.len() as u32);
        if event.created_at_unix_ms > last_event {
            last_event = event.created_at_unix_ms;
        }
        if first_event == 0 || event.created_at_unix_ms < first_event {
            first_event = event.created_at_unix_ms;
        }
    }

    let mut total_runs: u32 = 0;
    let mut total_cited: u32 = 0;
    let mut projects: Vec<ProjectMetrics> = Vec::with_capacity(per_project.len());
    for (project_id, agg) in per_project.into_iter() {
        // A "recent" run is inside the consistency window AND not in
        // the future (clock-skew safety). saturating_sub returns 0 for
        // future events so without the explicit `created <= now` check
        // a clock-skewed event would always count as recent.
        let recent = events
            .iter()
            .filter(|event| {
                event.project_id == project_id
                    && event.created_at_unix_ms <= now_unix_ms
                    && now_unix_ms.saturating_sub(event.created_at_unix_ms)
                        <= thresholds.consistency_window_ms
            })
            .count() as u32;
        total_runs = total_runs.saturating_add(agg.run_count);
        total_cited = total_cited.saturating_add(agg.cited_source_version_total);
        projects.push(ProjectMetrics {
            is_active_learner: agg.run_count >= thresholds.active_learner_min_runs,
            project_id,
            run_count: agg.run_count,
            due_count_total: agg.due_count_total,
            due_count_max: agg.due_count_max,
            last_run_unix_ms: agg.last_run_unix_ms,
            cited_source_version_total: agg.cited_source_version_total,
            recent_run_count: recent,
        });
    }

    LearningMetrics {
        schema_version: METRICS_SCHEMA_VERSION,
        thresholds: thresholds.clone(),
        total_runs,
        total_cited_source_versions: total_cited,
        projects,
        first_event_unix_ms: first_event,
        last_event_unix_ms: last_event,
    }
}

#[derive(Default, Debug, Clone)]
struct ProjectAggregate {
    run_count: u32,
    due_count_total: u32,
    due_count_max: u32,
    last_run_unix_ms: i64,
    cited_source_version_total: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_event(project_id: &str, due_count: u32, cited: u32, ts_ms: i64) -> LearningEvent {
        LearningEvent {
            event_type: "review_completed".to_string(),
            project_id: project_id.to_string(),
            run_id: format!("run_{ts_ms}"),
            due_count,
            cited_source_version_ids: (0..cited).map(|i| format!("v_{i}")).collect(),
            created_at_unix_ms: ts_ms,
        }
    }

    #[test]
    fn empty_event_stream_returns_zero_metrics_with_default_thresholds() {
        let thresholds = MetricsThresholds::default();
        let metrics = derive_learning_metrics(&[], &thresholds, 1_700_000_000_000);
        assert_eq!(metrics.total_runs, 0);
        assert_eq!(metrics.total_cited_source_versions, 0);
        assert!(metrics.projects.is_empty());
        assert_eq!(metrics.first_event_unix_ms, 0);
        assert_eq!(metrics.last_event_unix_ms, 0);
        // Thresholds are reported transparently so the UI can display them.
        assert_eq!(metrics.thresholds.active_learner_min_runs, 1);
    }

    #[test]
    fn aggregates_per_project_and_total_runs() {
        let thresholds = MetricsThresholds::default();
        let events = vec![
            make_event("project_a", 3, 2, 1_700_000_000_000),
            make_event("project_a", 1, 0, 1_700_000_500_000),
            make_event("project_b", 5, 4, 1_700_001_000_000),
        ];
        let metrics = derive_learning_metrics(&events, &thresholds, 1_700_002_000_000);
        assert_eq!(metrics.total_runs, 3);
        assert_eq!(metrics.total_cited_source_versions, 6);

        let a = metrics
            .projects
            .iter()
            .find(|p| p.project_id == "project_a")
            .expect("project_a present");
        assert_eq!(a.run_count, 2);
        assert_eq!(a.due_count_total, 4);
        assert_eq!(a.due_count_max, 3);
        assert_eq!(a.cited_source_version_total, 2);
        assert_eq!(a.last_run_unix_ms, 1_700_000_500_000);
        assert!(a.is_active_learner);

        let b = metrics
            .projects
            .iter()
            .find(|p| p.project_id == "project_b")
            .expect("project_b present");
        assert_eq!(b.due_count_total, 5);
        assert_eq!(b.cited_source_version_total, 4);
    }

    #[test]
    fn consistency_window_does_not_count_stale_runs() {
        // Custom threshold: 1 day window, 1 min run threshold.
        let thresholds = MetricsThresholds {
            active_learner_min_runs: 1,
            consistency_window_ms: 24 * 60 * 60 * 1000,
        };
        let now = 1_700_010_000_000i64;
        let events = vec![
            // 5 days ago, should NOT count as recent
            make_event("p1", 1, 1, now - 5 * 24 * 60 * 60 * 1000),
            // now
            make_event("p1", 1, 1, now),
        ];
        let metrics = derive_learning_metrics(&events, &thresholds, now);
        let p1 = &metrics.projects[0];
        assert_eq!(p1.run_count, 2);
        assert_eq!(p1.recent_run_count, 1);
        assert!(p1.is_active_learner);
    }

    #[test]
    fn active_learner_threshold_can_be_raised() {
        let thresholds = MetricsThresholds {
            active_learner_min_runs: 5,
            consistency_window_ms: 14 * 24 * 60 * 60 * 1000,
        };
        let events = vec![
            make_event("p_x", 1, 0, 1_700_000_000_000),
            make_event("p_x", 1, 0, 1_700_000_100_000),
        ];
        let metrics = derive_learning_metrics(&events, &thresholds, 1_700_001_000_000);
        assert_eq!(metrics.projects.len(), 1);
        assert!(
            !metrics.projects[0].is_active_learner,
            "with min_runs=5 and 2 events, must not be active"
        );
    }

    #[test]
    fn schema_and_thresholds_are_forward_compatible() {
        // Thresholds struct round-trips through serde so the UI can
        // display the live values.
        let thresholds = MetricsThresholds::default();
        let json = serde_json::to_string(&thresholds).expect("serialize");
        let back: MetricsThresholds = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back, thresholds);
    }

    #[test]
    fn future_dated_events_do_not_count_as_recent() {
        // Clock-skew safety: an event with a timestamp past "now"
        // must NOT count as recent (otherwise a single bad timestamp
        // could inflate the consistency score).
        let thresholds = MetricsThresholds {
            active_learner_min_runs: 1,
            consistency_window_ms: 24 * 60 * 60 * 1000,
        };
        let now = 1_700_000_000_000i64;
        let events = vec![
            make_event("p1", 1, 0, now + 60_000), // 60s in the future
            make_event("p1", 1, 0, now - 60_000), // 60s ago
        ];
        let metrics = derive_learning_metrics(&events, &thresholds, now);
        let p1 = &metrics.projects[0];
        assert_eq!(p1.recent_run_count, 1, "future event must not be recent");
    }

    #[test]
    fn end_to_end_metrics_come_from_real_review_runs() {
        // Use the actual ReviewRunRegistry to confirm the metric pipeline
        // reads from the same JSONL the registry writes. This is the
        // regression seam against accidental "metric magic" — every
        // number in the dashboard must trace back to an on-disk event.
        let root = std::env::temp_dir().join(format!(
            "slice4-metrics-e2e-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let project_id = crate::project_vault::ProjectVault::initialize(&root)
            .unwrap()
            .create_project("Metrics E2E")
            .unwrap()
            .project
            .project_id;
        let registry = crate::review_runs::ReviewRunRegistry::new(&root);
        registry
            .create(&project_id, "First", &[], &[], 2, 1_700_000_000_000)
            .expect("first run");
        registry
            .create(&project_id, "Second", &[], &[], 5, 1_700_000_500_000)
            .expect("second run");

        let events = registry.list_learning_events().expect("events");
        let metrics = derive_learning_metrics(
            &events,
            &MetricsThresholds::default(),
            1_700_001_000_000,
        );
        assert_eq!(metrics.total_runs, 2);
        assert_eq!(metrics.projects.len(), 1);
        let m = &metrics.projects[0];
        assert_eq!(m.project_id, project_id);
        assert_eq!(m.run_count, 2);
        assert_eq!(m.due_count_total, 7);
        assert_eq!(m.due_count_max, 5);
        assert!(m.is_active_learner);

        let _ = std::fs::remove_dir_all(&root);
    }
}

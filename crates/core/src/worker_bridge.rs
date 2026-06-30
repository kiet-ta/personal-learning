use serde::{Deserialize, Serialize};
use std::fmt;
use std::process::Command;

/// Input passed to a Python document worker via stdin JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerInput {
    pub source_name: String,
    pub content: String,
}

/// A single node extracted by the Python document worker.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkerNode {
    pub node_id: String,
    pub title: String,
    pub summary: String,
    pub section_path: String,
    pub start_line: u32,
    pub end_line: u32,
}

/// Output produced by a Python document worker.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkerOutput {
    pub nodes: Vec<WorkerNode>,
    pub error: Option<String>,
}

/// Errors that can occur when bridging to a Python document worker.
#[derive(Debug, Clone)]
pub enum WorkerBridgeError {
    /// The worker script was not found at the given path.
    WorkerNotFound(String),
    /// The worker exited with a non-zero status or produced no stdout.
    ExecutionFailed(String),
    /// The worker's stdout could not be parsed as valid WorkerOutput JSON.
    ParseError(String),
}

impl fmt::Display for WorkerBridgeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            WorkerBridgeError::WorkerNotFound(path) => {
                write!(f, "document worker not found at path: {}", path)
            }
            WorkerBridgeError::ExecutionFailed(msg) => {
                write!(f, "document worker execution failed: {}", msg)
            }
            WorkerBridgeError::ParseError(msg) => {
                write!(f, "failed to parse worker output: {}", msg)
            }
        }
    }
}

impl std::error::Error for WorkerBridgeError {}

/// Run a Python document worker script, passing the input as JSON via `--input`.
///
/// The worker is expected to accept `--input <json>` on the command line and
/// print a single JSON object (matching [`WorkerOutput`]) to stdout.
pub fn run_document_worker(
    worker_path: &str,
    input: &WorkerInput,
) -> Result<WorkerOutput, WorkerBridgeError> {
    // Serialize input to JSON.
    let input_json =
        serde_json::to_string(input).map_err(|e| WorkerBridgeError::ExecutionFailed(e.to_string()))?;

    // Check that the worker script exists.
    let worker_path = std::path::Path::new(worker_path);
    if !worker_path.exists() {
        return Err(WorkerBridgeError::WorkerNotFound(
            worker_path.to_string_lossy().to_string(),
        ));
    }

    // Run the Python subprocess.
    let output = Command::new("python")
        .arg(worker_path)
        .arg("--input")
        .arg(&input_json)
        .output()
        .map_err(|e| {
            WorkerBridgeError::ExecutionFailed(format!("failed to spawn python process: {}", e))
        })?;

    // Check for non-zero exit.
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let msg = if !stderr.is_empty() {
            format!(
                "worker exited with code {:?}: {}",
                output.status.code(),
                stderr.trim()
            )
        } else if !stdout.is_empty() {
            format!(
                "worker exited with code {:?}: {}",
                output.status.code(),
                stdout.trim()
            )
        } else {
            format!("worker exited with code {:?}", output.status.code())
        };
        return Err(WorkerBridgeError::ExecutionFailed(msg));
    }

    // Parse stdout as WorkerOutput.
    let stdout_str = String::from_utf8_lossy(&output.stdout);
    if stdout_str.trim().is_empty() {
        return Err(WorkerBridgeError::ExecutionFailed(
            "worker produced no output on stdout".to_string(),
        ));
    }

    serde_json::from_str(stdout_str.trim()).map_err(|e| {
        WorkerBridgeError::ParseError(format!(
            "invalid JSON from worker: {} (raw: {})",
            e,
            stdout_str.trim()
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worker_not_found_returns_clear_error() {
        let input = WorkerInput {
            source_name: "test.txt".into(),
            content: "hello".into(),
        };
        let result = run_document_worker("/nonexistent/worker.py", &input);
        match result {
            Err(WorkerBridgeError::WorkerNotFound(path)) => {
                assert!(path.contains("nonexistent"), "path should be in error: {}", path);
            }
            other => panic!("expected WorkerNotFound, got: {:?}", other),
        }
    }

    #[test]
    fn worker_input_serializes_correctly() {
        let input = WorkerInput {
            source_name: "my_doc.md".into(),
            content: "# Hello\nWorld".into(),
        };
        let json = serde_json::to_string(&input).expect("serialization should succeed");
        // serde_json escapes newlines as \n in JSON output
        assert_eq!(
            json,
            "{\"source_name\":\"my_doc.md\",\"content\":\"# Hello\\nWorld\"}"
        );
    }

    #[test]
    fn worker_output_deserializes_correctly() {
        let json = r#"{
            "nodes": [
                {
                    "node_id": "n1",
                    "title": "Introduction",
                    "summary": "First section",
                    "section_path": "intro",
                    "start_line": 1,
                    "end_line": 10
                }
            ],
            "error": null
        }"#;
        let output: WorkerOutput = serde_json::from_str(json).expect("deserialization should succeed");
        assert_eq!(output.nodes.len(), 1);
        assert_eq!(output.nodes[0].node_id, "n1");
        assert_eq!(output.nodes[0].title, "Introduction");
        assert_eq!(output.nodes[0].summary, "First section");
        assert_eq!(output.nodes[0].section_path, "intro");
        assert_eq!(output.nodes[0].start_line, 1);
        assert_eq!(output.nodes[0].end_line, 10);
        assert!(output.error.is_none());

        // Test with error present.
        let json_with_error = r#"{"nodes":[],"error":"something went wrong"}"#;
        let output_with_error: WorkerOutput =
            serde_json::from_str(json_with_error).expect("deserialization should succeed");
        assert!(output_with_error.nodes.is_empty());
        assert_eq!(
            output_with_error.error.as_deref(),
            Some("something went wrong")
        );
    }
}

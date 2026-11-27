//! Piano Learner audio engine.

pub mod core;
pub mod output;

#[cfg(not(feature = "noop"))]
pub mod api;

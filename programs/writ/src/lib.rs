//! Writ — on-chain spending mandates for autonomous AI agents.
//!
//! An AI agent that can pay for things is only as trustworthy as the content it
//! reads. A prompt injection hidden in a web page can tell an agent to send
//! money to an attacker, and on-chain payments are final.
//!
//! Writ moves the spending rules off the agent and onto the chain. The human
//! signs a mandate: which merchants may be paid, how much per payment, how much
//! per day, and until when. Funds live in a vault owned by a program-derived
//! address with no private key. The agent can only *request* a payment; the
//! program decides whether it happens.
//!
//! The guarantee: even if the agent is manipulated, its host server is
//! compromised and its signing key is stolen, an attacker cannot move funds
//! outside the mandate.

use anchor_lang::prelude::*;

// Placeholder program id. `anchor keys sync` replaces this with the keypair in
// target/deploy once you build locally.
declare_id!("6cc4F1dBC34KwyJFphJqAJfuSudNhUA6W2UNozUsVqrT");

#[program]
pub mod writ {
    use super::*;
}

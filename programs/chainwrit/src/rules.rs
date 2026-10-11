//! The policy engine.
//!
//! Every spending rule lives here as pure logic with no Solana account
//! plumbing, so it can be read, reasoned about and unit-tested on its own. The
//! `pay` instruction is a thin wrapper: it loads state, calls [`evaluate`], and
//! moves tokens only if the answer is `Ok`.
//!
//! Keeping the rules pure is deliberate. The security claim of this program is
//! that a payment outside the mandate is impossible, and that claim is only as
//! good as the tests behind these functions.

use anchor_lang::prelude::*;

use crate::{ChainwritError, MAX_TASK_ID_LEN, WINDOW_SECONDS};

/// The mutable spend state of a mandate, as stored on-chain.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SpendState {
    pub revoked: bool,
    pub expires_at: i64,
    pub max_per_payment: u64,
    pub daily_limit: u64,
    pub spent_in_window: u64,
    pub window_start: i64,
}

/// What the agent is asking to do.
#[derive(Clone, Copy, Debug)]
pub struct PaymentRequest<'a> {
    pub amount: u64,
    pub merchant: Pubkey,
    pub task_id: &'a str,
}

/// The new spend state to commit when a payment is allowed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Approval {
    pub window_start: i64,
    pub spent_in_window: u64,
}

/// Decide whether a payment is allowed under the mandate.
///
/// Returns the state to commit on approval, or the specific rule that rejected
/// it. This function never mutates anything: a rejected payment leaves the
/// mandate exactly as it was.
pub fn evaluate(
    state: SpendState,
    merchants: &[Pubkey],
    request: PaymentRequest<'_>,
    now: i64,
) -> std::result::Result<Approval, ChainwritError> {
    if request.amount == 0 {
        return Err(ChainwritError::ZeroAmount);
    }
    if request.task_id.len() > MAX_TASK_ID_LEN {
        return Err(ChainwritError::TaskIdTooLong);
    }
    if state.revoked {
        return Err(ChainwritError::MandateRevoked);
    }
    if now >= state.expires_at {
        return Err(ChainwritError::MandateExpired);
    }
    if request.amount > state.max_per_payment {
        return Err(ChainwritError::ExceedsPerPaymentLimit);
    }
    if !merchants.contains(&request.merchant) {
        return Err(ChainwritError::MerchantNotAllowed);
    }

    // Roll the window forward if the previous one has fully elapsed. Spend
    // inside an open window accumulates; a new window starts from zero.
    let (window_start, spent_so_far) = if now.saturating_sub(state.window_start) >= WINDOW_SECONDS {
        (now, 0u64)
    } else {
        (state.window_start, state.spent_in_window)
    };

    let spent_after = spent_so_far
        .checked_add(request.amount)
        .ok_or(ChainwritError::MathOverflow)?;

    if spent_after > state.daily_limit {
        return Err(ChainwritError::ExceedsDailyLimit);
    }

    Ok(Approval {
        window_start,
        spent_in_window: spent_after,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_760_000_000;

    fn merchant_a() -> Pubkey {
        Pubkey::new_from_array([1u8; 32])
    }

    fn merchant_b() -> Pubkey {
        Pubkey::new_from_array([2u8; 32])
    }

    /// An address that is deliberately NOT on the allowlist: the attacker.
    fn attacker() -> Pubkey {
        Pubkey::new_from_array([9u8; 32])
    }

    fn allowlist() -> Vec<Pubkey> {
        vec![merchant_a(), merchant_b()]
    }

    /// A healthy mandate: 2 USDC per payment, 50 USDC per day, expires in a week.
    fn healthy() -> SpendState {
        SpendState {
            revoked: false,
            expires_at: NOW + 7 * 86_400,
            max_per_payment: 2_000_000,
            daily_limit: 50_000_000,
            spent_in_window: 0,
            window_start: NOW,
        }
    }

    fn request(amount: u64, merchant: Pubkey) -> PaymentRequest<'static> {
        PaymentRequest {
            amount,
            merchant,
            task_id: "research-run-01",
        }
    }

    #[test]
    fn allows_a_payment_that_fits_the_mandate() {
        let approval = evaluate(healthy(), &allowlist(), request(1_000_000, merchant_a()), NOW)
            .expect("payment should be allowed");

        assert_eq!(approval.spent_in_window, 1_000_000);
        assert_eq!(approval.window_start, NOW);
    }

    /// The attack from the demo: a prompt injection tells the agent to pay an
    /// address the human never approved.
    #[test]
    fn rejects_a_merchant_that_is_not_on_the_allowlist() {
        let err = evaluate(healthy(), &allowlist(), request(1_000_000, attacker()), NOW)
            .expect_err("payment to an unknown address must be rejected");

        assert_eq!(err, ChainwritError::MerchantNotAllowed);
    }

    /// A small payment to the attacker is still rejected: the allowlist, not the
    /// cap, is what stops this attack.
    #[test]
    fn rejects_a_tiny_payment_to_an_unknown_merchant() {
        let err = evaluate(healthy(), &allowlist(), request(1, attacker()), NOW)
            .expect_err("amount does not make an unknown merchant acceptable");

        assert_eq!(err, ChainwritError::MerchantNotAllowed);
    }

    #[test]
    fn rejects_a_payment_over_the_per_payment_cap() {
        let err = evaluate(healthy(), &allowlist(), request(2_000_001, merchant_a()), NOW)
            .expect_err("payment above the cap must be rejected");

        assert_eq!(err, ChainwritError::ExceedsPerPaymentLimit);
    }

    #[test]
    fn allows_a_payment_exactly_at_the_per_payment_cap() {
        let approval = evaluate(healthy(), &allowlist(), request(2_000_000, merchant_a()), NOW)
            .expect("the cap itself is allowed");

        assert_eq!(approval.spent_in_window, 2_000_000);
    }

    #[test]
    fn rejects_a_payment_that_would_cross_the_daily_limit() {
        let mut state = healthy();
        state.spent_in_window = 49_000_000; // 49 of 50 USDC already spent today

        let err = evaluate(state, &allowlist(), request(2_000_000, merchant_a()), NOW)
            .expect_err("crossing the daily limit must be rejected");

        assert_eq!(err, ChainwritError::ExceedsDailyLimit);
    }

    #[test]
    fn allows_a_payment_that_exactly_reaches_the_daily_limit() {
        let mut state = healthy();
        state.spent_in_window = 48_000_000;

        let approval = evaluate(state, &allowlist(), request(2_000_000, merchant_a()), NOW)
            .expect("reaching the limit exactly is allowed");

        assert_eq!(approval.spent_in_window, 50_000_000);
    }

    /// Draining the wallet slowly, a little at a time, is the attack the daily
    /// limit exists to stop.
    #[test]
    fn stops_a_slow_drain_once_the_daily_limit_is_reached() {
        let mut state = healthy();
        let mut approved = 0u64;

        for _ in 0..40 {
            match evaluate(state, &allowlist(), request(2_000_000, merchant_a()), NOW) {
                Ok(approval) => {
                    approved += 2_000_000;
                    state.spent_in_window = approval.spent_in_window;
                    state.window_start = approval.window_start;
                }
                Err(err) => {
                    assert_eq!(err, ChainwritError::ExceedsDailyLimit);
                    break;
                }
            }
        }

        assert_eq!(approved, 50_000_000, "no more than the daily limit gets out");
    }

    #[test]
    fn rejects_payments_after_expiry() {
        let state = healthy();
        let after_expiry = state.expires_at + 1;

        let err = evaluate(state, &allowlist(), request(1, merchant_a()), after_expiry)
            .expect_err("an expired mandate pays nothing");

        assert_eq!(err, ChainwritError::MandateExpired);
    }

    #[test]
    fn rejects_payments_at_the_moment_of_expiry() {
        let state = healthy();

        let err = evaluate(state, &allowlist(), request(1, merchant_a()), state.expires_at)
            .expect_err("expiry is exclusive");

        assert_eq!(err, ChainwritError::MandateExpired);
    }

    #[test]
    fn rejects_payments_once_revoked() {
        let mut state = healthy();
        state.revoked = true;

        let err = evaluate(state, &allowlist(), request(1, merchant_a()), NOW)
            .expect_err("a revoked mandate pays nothing");

        assert_eq!(err, ChainwritError::MandateRevoked);
    }

    /// Revocation beats every other rule, including a payment that would
    /// otherwise be perfectly valid.
    #[test]
    fn revocation_overrides_an_otherwise_valid_payment() {
        let mut state = healthy();
        state.revoked = true;

        assert!(evaluate(state, &allowlist(), request(1_000_000, merchant_a()), NOW).is_err());
    }

    #[test]
    fn opens_a_fresh_window_once_twenty_four_hours_have_passed() {
        let mut state = healthy();
        state.spent_in_window = state.daily_limit; // fully spent yesterday

        let tomorrow = NOW + WINDOW_SECONDS;
        let approval = evaluate(state, &allowlist(), request(2_000_000, merchant_a()), tomorrow)
            .expect("a new window starts from zero");

        assert_eq!(approval.window_start, tomorrow);
        assert_eq!(approval.spent_in_window, 2_000_000);
    }

    #[test]
    fn keeps_the_window_open_one_second_before_it_elapses() {
        let mut state = healthy();
        state.spent_in_window = state.daily_limit;

        let almost = NOW + WINDOW_SECONDS - 1;
        let err = evaluate(state, &allowlist(), request(1, merchant_a()), almost)
            .expect_err("the window has not rolled over yet");

        assert_eq!(err, ChainwritError::ExceedsDailyLimit);
    }

    #[test]
    fn rejects_a_zero_amount() {
        let err = evaluate(healthy(), &allowlist(), request(0, merchant_a()), NOW)
            .expect_err("zero is not a payment");

        assert_eq!(err, ChainwritError::ZeroAmount);
    }

    #[test]
    fn rejects_an_oversized_task_id() {
        let long = "x".repeat(MAX_TASK_ID_LEN + 1);
        let req = PaymentRequest {
            amount: 1,
            merchant: merchant_a(),
            task_id: &long,
        };

        assert_eq!(
            evaluate(healthy(), &allowlist(), req, NOW).expect_err("task id is bounded"),
            ChainwritError::TaskIdTooLong
        );
    }

    #[test]
    fn does_not_overflow_when_spend_is_near_the_maximum() {
        let mut state = healthy();
        state.max_per_payment = u64::MAX;
        state.daily_limit = u64::MAX;
        state.spent_in_window = u64::MAX;

        let err = evaluate(state, &allowlist(), request(1, merchant_a()), NOW)
            .expect_err("saturated spend must not wrap around");

        assert_eq!(err, ChainwritError::MathOverflow);
    }

    /// Rule precedence: an expired mandate is rejected for being expired, not
    /// for whatever else is also wrong with the request.
    #[test]
    fn reports_revocation_before_other_failures() {
        let mut state = healthy();
        state.revoked = true;

        let err = evaluate(state, &allowlist(), request(u64::MAX, attacker()), NOW)
            .expect_err("should fail");

        assert_eq!(err, ChainwritError::MandateRevoked);
    }
}

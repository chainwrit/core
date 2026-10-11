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
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

pub mod rules;

// Placeholder program id. `anchor keys sync` replaces this with the keypair in
// target/deploy once you build locally.
declare_id!("6cc4F1dBC34KwyJFphJqAJfuSudNhUA6W2UNozUsVqrT");

/// Maximum number of merchant addresses a single mandate may allow.
pub const MAX_MERCHANTS: usize = 10;

/// Maximum length, in bytes, of the task tag attached to a payment.
pub const MAX_TASK_ID_LEN: usize = 32;

/// Length of the rolling spend window, in seconds.
pub const WINDOW_SECONDS: i64 = 86_400;

#[program]
pub mod writ {
    use super::*;

    /// Create a mandate: the human's signed statement of what the agent may spend.
    ///
    /// The mandate account is a PDA derived from the owner and the agent, so one
    /// owner can run many agents with different limits.
    pub fn create_mandate(
        ctx: Context<CreateMandate>,
        max_per_payment: u64,
        daily_limit: u64,
        expires_at: i64,
        merchants: Vec<Pubkey>,
    ) -> Result<()> {
        require!(max_per_payment > 0, WritError::InvalidLimit);
        require!(daily_limit >= max_per_payment, WritError::InvalidLimit);
        require!(!merchants.is_empty(), WritError::EmptyMerchantList);
        require!(
            merchants.len() <= MAX_MERCHANTS,
            WritError::TooManyMerchants
        );

        let now = Clock::get()?.unix_timestamp;
        require!(expires_at > now, WritError::ExpiryInPast);

        let mandate = &mut ctx.accounts.mandate;
        mandate.owner = ctx.accounts.owner.key();
        mandate.agent = ctx.accounts.agent.key();
        mandate.mint = ctx.accounts.mint.key();
        mandate.vault = ctx.accounts.vault.key();
        mandate.max_per_payment = max_per_payment;
        mandate.daily_limit = daily_limit;
        mandate.spent_in_window = 0;
        mandate.window_start = now;
        mandate.expires_at = expires_at;
        mandate.revoked = false;
        mandate.total_spent = 0;
        mandate.payment_count = 0;
        mandate.merchants = merchants;
        mandate.bump = ctx.bumps.mandate;

        emit!(MandateCreated {
            mandate: mandate.key(),
            owner: mandate.owner,
            agent: mandate.agent,
            max_per_payment,
            daily_limit,
            expires_at,
        });

        Ok(())
    }

    /// Fund the mandate's vault from the owner's own token account.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, WritError::ZeroAmount);

        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.owner_token_account.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        Ok(())
    }

    /// Pay a merchant on the agent's behalf, if and only if the payment fits the
    /// mandate.
    ///
    /// This is the heart of the program. Every check below runs on-chain, so a
    /// compromised agent, server or signing key cannot skip them.
    pub fn pay(ctx: Context<Pay>, amount: u64, task_id: String) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let merchant = ctx.accounts.merchant_token_account.owner;

        // Ask the policy engine. It reads state and returns the state to commit,
        // or the specific rule that rejected the payment. Nothing is mutated
        // until it says yes, so a rejected payment leaves the mandate untouched.
        let approval = {
            let mandate = &ctx.accounts.mandate;
            rules::evaluate(
                rules::SpendState {
                    revoked: mandate.revoked,
                    expires_at: mandate.expires_at,
                    max_per_payment: mandate.max_per_payment,
                    daily_limit: mandate.daily_limit,
                    spent_in_window: mandate.spent_in_window,
                    window_start: mandate.window_start,
                },
                &mandate.merchants,
                rules::PaymentRequest {
                    amount,
                    merchant,
                    task_id: &task_id,
                },
                now,
            )?
        };

        // Approved. The mandate PDA signs its own vault's transfer.
        let mandate = &ctx.accounts.mandate;
        let owner_key = mandate.owner;
        let agent_key = mandate.agent;
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"mandate",
            owner_key.as_ref(),
            agent_key.as_ref(),
            &[mandate.bump],
        ]];

        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.merchant_token_account.to_account_info(),
                    authority: ctx.accounts.mandate.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        let mandate = &mut ctx.accounts.mandate;
        mandate.window_start = approval.window_start;
        mandate.spent_in_window = approval.spent_in_window;
        mandate.total_spent = mandate
            .total_spent
            .checked_add(amount)
            .ok_or(WritError::MathOverflow)?;
        mandate.payment_count = mandate
            .payment_count
            .checked_add(1)
            .ok_or(WritError::MathOverflow)?;

        emit!(PaymentExecuted {
            mandate: mandate.key(),
            agent: mandate.agent,
            merchant,
            amount,
            task_id,
            spent_in_window: mandate.spent_in_window,
            timestamp: now,
        });

        Ok(())
    }

    /// Revoke the mandate. Takes effect on the next payment attempt, immediately.
    pub fn revoke(ctx: Context<Revoke>) -> Result<()> {
        let mandate = &mut ctx.accounts.mandate;
        require!(!mandate.revoked, WritError::MandateRevoked);
        mandate.revoked = true;

        emit!(MandateRevoked {
            mandate: mandate.key(),
            owner: mandate.owner,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Withdraw funds from the vault back to the owner. Only the owner may do this.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, WritError::ZeroAmount);
        require!(
            ctx.accounts.vault.amount >= amount,
            WritError::InsufficientVaultBalance
        );

        let mandate = &ctx.accounts.mandate;
        let owner_key = mandate.owner;
        let agent_key = mandate.agent;
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"mandate",
            owner_key.as_ref(),
            agent_key.as_ref(),
            &[mandate.bump],
        ]];

        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.owner_token_account.to_account_info(),
                    authority: ctx.accounts.mandate.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/// A human's signed statement of what one agent may spend.
#[account]
pub struct Mandate {
    /// The human who created the mandate and owns the funds.
    pub owner: Pubkey,
    /// The agent's signing key. Only this key may request payments.
    pub agent: Pubkey,
    /// The token the mandate is denominated in (USDC in practice).
    pub mint: Pubkey,
    /// The vault token account holding the funds.
    pub vault: Pubkey,
    /// Ceiling on any single payment.
    pub max_per_payment: u64,
    /// Ceiling on total spend inside a rolling 24-hour window.
    pub daily_limit: u64,
    /// Spend so far inside the current window.
    pub spent_in_window: u64,
    /// When the current window opened.
    pub window_start: i64,
    /// After this timestamp the mandate pays nothing.
    pub expires_at: i64,
    /// Set by the owner to stop all payments immediately.
    pub revoked: bool,
    /// Lifetime spend, for reporting.
    pub total_spent: u64,
    /// Lifetime payment count, for reporting.
    pub payment_count: u64,
    /// Addresses this agent is allowed to pay.
    pub merchants: Vec<Pubkey>,
    pub bump: u8,
}

impl Mandate {
    pub const SPACE: usize = 8   // discriminator
        + 32  // owner
        + 32  // agent
        + 32  // mint
        + 32  // vault
        + 8   // max_per_payment
        + 8   // daily_limit
        + 8   // spent_in_window
        + 8   // window_start
        + 8   // expires_at
        + 1   // revoked
        + 8   // total_spent
        + 8   // payment_count
        + 4 + (32 * MAX_MERCHANTS) // merchants
        + 1; // bump
}

#[derive(Accounts)]
pub struct CreateMandate<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    /// CHECK: stored as the only key allowed to request payments. It never signs
    /// here, so no further validation is possible or needed.
    pub agent: UncheckedAccount<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = owner,
        space = Mandate::SPACE,
        seeds = [b"mandate", owner.key().as_ref(), agent.key().as_ref()],
        bump
    )]
    pub mandate: Account<'info, Mandate>,

    /// The vault holding the funds. Its authority is the mandate PDA, which has
    /// no private key, so nobody can move these funds except through `pay` or
    /// `withdraw`.
    #[account(
        init,
        payer = owner,
        seeds = [b"vault", mandate.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = mandate
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [b"mandate", mandate.owner.as_ref(), mandate.agent.as_ref()],
        bump = mandate.bump,
        has_one = owner @ WritError::NotMandateOwner,
        has_one = mint @ WritError::WrongMint,
        has_one = vault @ WritError::WrongVault,
    )]
    pub mandate: Account<'info, Mandate>,

    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = owner_token_account.owner == owner.key() @ WritError::NotMandateOwner,
        constraint = owner_token_account.mint == mandate.mint @ WritError::WrongMint,
    )]
    pub owner_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Pay<'info> {
    /// The agent requesting the payment. Signing proves it is the agent named in
    /// the mandate; it proves nothing about whether the payment is a good idea,
    /// which is exactly why the program checks the rules below.
    pub agent: Signer<'info>,

    #[account(
        mut,
        seeds = [b"mandate", mandate.owner.as_ref(), mandate.agent.as_ref()],
        bump = mandate.bump,
        has_one = agent @ WritError::NotMandateAgent,
        has_one = mint @ WritError::WrongMint,
        has_one = vault @ WritError::WrongVault,
    )]
    pub mandate: Account<'info, Mandate>,

    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = merchant_token_account.mint == mandate.mint @ WritError::WrongMint,
    )]
    pub merchant_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Revoke<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [b"mandate", mandate.owner.as_ref(), mandate.agent.as_ref()],
        bump = mandate.bump,
        has_one = owner @ WritError::NotMandateOwner,
    )]
    pub mandate: Account<'info, Mandate>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [b"mandate", mandate.owner.as_ref(), mandate.agent.as_ref()],
        bump = mandate.bump,
        has_one = owner @ WritError::NotMandateOwner,
        has_one = mint @ WritError::WrongMint,
        has_one = vault @ WritError::WrongVault,
    )]
    pub mandate: Account<'info, Mandate>,

    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = owner_token_account.owner == owner.key() @ WritError::NotMandateOwner,
        constraint = owner_token_account.mint == mandate.mint @ WritError::WrongMint,
    )]
    pub owner_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct MandateCreated {
    pub mandate: Pubkey,
    pub owner: Pubkey,
    pub agent: Pubkey,
    pub max_per_payment: u64,
    pub daily_limit: u64,
    pub expires_at: i64,
}

/// Emitted on every successful payment. The indexer turns these into per-agent
/// and per-task spend reporting.
#[event]
pub struct PaymentExecuted {
    pub mandate: Pubkey,
    pub agent: Pubkey,
    pub merchant: Pubkey,
    pub amount: u64,
    pub task_id: String,
    pub spent_in_window: u64,
    pub timestamp: i64,
}

#[event]
pub struct MandateRevoked {
    pub mandate: Pubkey,
    pub owner: Pubkey,
    pub timestamp: i64,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
#[derive(PartialEq, Eq)]
pub enum WritError {
    #[msg("This merchant is not on the mandate's allowlist")]
    MerchantNotAllowed,
    #[msg("Payment exceeds the per-payment limit")]
    ExceedsPerPaymentLimit,
    #[msg("Payment would exceed the rolling 24-hour limit")]
    ExceedsDailyLimit,
    #[msg("This mandate has expired")]
    MandateExpired,
    #[msg("This mandate has been revoked")]
    MandateRevoked,
    #[msg("Signer is not the agent named in this mandate")]
    NotMandateAgent,
    #[msg("Signer is not the owner of this mandate")]
    NotMandateOwner,
    #[msg("Token mint does not match the mandate")]
    WrongMint,
    #[msg("Vault does not match the mandate")]
    WrongVault,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Limits must be greater than zero and the daily limit at least the per-payment limit")]
    InvalidLimit,
    #[msg("A mandate must allow at least one merchant")]
    EmptyMerchantList,
    #[msg("Too many merchants for one mandate")]
    TooManyMerchants,
    #[msg("Expiry must be in the future")]
    ExpiryInPast,
    #[msg("Task id is too long")]
    TaskIdTooLong,
    #[msg("Vault does not hold enough tokens")]
    InsufficientVaultBalance,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}

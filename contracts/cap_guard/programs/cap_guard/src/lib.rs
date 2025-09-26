use anchor_lang::prelude::*;
use anchor_lang::InitSpace;
use anchor_spl::token_interface::{TokenAccount, Mint};          // account types
use anchor_spl::token_2022::{                                    // CPI for transfer_checked
    self as token_interface,
    Token2022 as TokenInterface,
    TransferChecked,
    transfer_checked,
};

declare_id!("C8RGfQJMVyUEGS9bMKoMnfvU1mZJYQ35dVdhxQSZ5iqr");

#[program]
pub mod cap_guard {
    use super::*;

    pub fn init_config(ctx: Context<InitConfig>, max_percent: u8) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.max_percent = max_percent;
        config.graduated = false;
        Ok(())
    }

    pub fn set_graduated(ctx: Context<SetGraduated>, graduated: bool) -> Result<()> {
        require_keys_eq!(ctx.accounts.authority.key(), ctx.accounts.config.authority, CustomError::Unauthorized);
        ctx.accounts.config.graduated = graduated;
        Ok(())
    }

    pub fn guarded_transfer(ctx: Context<GuardedTransfer>, amount: u64) -> Result<()> {
        let config = &ctx.accounts.config;

        // If not graduated, enforce % cap
        if !config.graduated {
            let mint = &ctx.accounts.mint;
            let dest = &ctx.accounts.destination;

            let supply = mint.supply;
            let max_allowed = (supply as u128 * config.max_percent as u128) / 100;
            let new_balance = dest.amount as u128 + amount as u128;

            require!(new_balance <= max_allowed, CustomError::OverCap);
        }

        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.from.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        );
        transfer_checked(cpi_ctx, amount, ctx.accounts.mint.decimals)
    }
}

#[derive(Accounts)]
pub struct InitConfig<'info> {
    // use compile-time size from InitSpace derive
    #[account(init, payer = authority, space = 8 + Config::INIT_SPACE)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetGraduated<'info> {
    #[account(mut)]
    pub config: Account<'info, Config>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct GuardedTransfer<'info> {
    #[account(mut)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub from: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub destination: InterfaceAccount<'info, TokenAccount>,
    pub mint: InterfaceAccount<'info, Mint>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, TokenInterface>,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey, // 32
    pub max_percent: u8,   // 1
    pub graduated: bool,   // 1
}

#[error_code]
pub enum CustomError {
    #[msg("Transfer exceeds max cap before graduation")]
    OverCap,
    #[msg("Only authority may update this config")]
    Unauthorized,
}

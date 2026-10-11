/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/chainwrit.json`.
 */
export type Chainwrit = {
  "address": "5BSoxqzNLqi7aZxLMRWCGXCm186aaUzswjHV7i99P9FW",
  "metadata": {
    "name": "chainwrit",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "On-chain spending mandates for autonomous AI agents"
  },
  "instructions": [
    {
      "name": "createMandate",
      "docs": [
        "Create a mandate: the human's signed statement of what the agent may spend.",
        "",
        "The mandate account is a PDA derived from the owner and the agent, so one",
        "owner can run many agents with different limits."
      ],
      "discriminator": [
        230,
        170,
        158,
        68,
        33,
        169,
        16,
        158
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "agent",
          "docs": [
            "here, so no further validation is possible or needed."
          ]
        },
        {
          "name": "mint"
        },
        {
          "name": "mandate",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  110,
                  100,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "agent"
              }
            ]
          }
        },
        {
          "name": "vault",
          "docs": [
            "The vault holding the funds. Its authority is the mandate PDA, which has",
            "no private key, so nobody can move these funds except through `pay` or",
            "`withdraw`."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "mandate"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "maxPerPayment",
          "type": "u64"
        },
        {
          "name": "dailyLimit",
          "type": "u64"
        },
        {
          "name": "expiresAt",
          "type": "i64"
        },
        {
          "name": "merchants",
          "type": {
            "vec": "pubkey"
          }
        }
      ]
    },
    {
      "name": "deposit",
      "docs": [
        "Fund the mandate's vault from the owner's own token account."
      ],
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "mandate"
          ]
        },
        {
          "name": "mandate",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  110,
                  100,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mandate.owner",
                "account": "mandate"
              },
              {
                "kind": "account",
                "path": "mandate.agent",
                "account": "mandate"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "mandate"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "mandate"
          ]
        },
        {
          "name": "ownerTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "pay",
      "docs": [
        "Pay a merchant on the agent's behalf, if and only if the payment fits the",
        "mandate.",
        "",
        "This is the heart of the program. Every check below runs on-chain, so a",
        "compromised agent, server or signing key cannot skip them."
      ],
      "discriminator": [
        119,
        18,
        216,
        65,
        192,
        117,
        122,
        220
      ],
      "accounts": [
        {
          "name": "agent",
          "docs": [
            "The agent requesting the payment. Signing proves it is the agent named in",
            "the mandate; it proves nothing about whether the payment is a good idea,",
            "which is exactly why the program checks the rules below."
          ],
          "signer": true,
          "relations": [
            "mandate"
          ]
        },
        {
          "name": "mandate",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  110,
                  100,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mandate.owner",
                "account": "mandate"
              },
              {
                "kind": "account",
                "path": "mandate.agent",
                "account": "mandate"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "mandate"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "mandate"
          ]
        },
        {
          "name": "merchantTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "taskId",
          "type": "string"
        }
      ]
    },
    {
      "name": "revoke",
      "docs": [
        "Revoke the mandate. Takes effect on the next payment attempt, immediately."
      ],
      "discriminator": [
        170,
        23,
        31,
        34,
        133,
        173,
        93,
        242
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "mandate"
          ]
        },
        {
          "name": "mandate",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  110,
                  100,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mandate.owner",
                "account": "mandate"
              },
              {
                "kind": "account",
                "path": "mandate.agent",
                "account": "mandate"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "withdraw",
      "docs": [
        "Withdraw funds from the vault back to the owner. Only the owner may do this."
      ],
      "discriminator": [
        183,
        18,
        70,
        156,
        148,
        109,
        161,
        34
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "mandate"
          ]
        },
        {
          "name": "mandate",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  110,
                  100,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mandate.owner",
                "account": "mandate"
              },
              {
                "kind": "account",
                "path": "mandate.agent",
                "account": "mandate"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "mandate"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "mandate"
          ]
        },
        {
          "name": "ownerTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "mandate",
      "discriminator": [
        113,
        216,
        98,
        159,
        185,
        63,
        55,
        18
      ]
    }
  ],
  "events": [
    {
      "name": "mandateCreated",
      "discriminator": [
        140,
        30,
        209,
        254,
        5,
        128,
        147,
        113
      ]
    },
    {
      "name": "mandateRevoked",
      "discriminator": [
        228,
        111,
        181,
        60,
        204,
        58,
        131,
        28
      ]
    },
    {
      "name": "paymentExecuted",
      "discriminator": [
        153,
        165,
        141,
        18,
        246,
        20,
        204,
        227
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "merchantNotAllowed",
      "msg": "This merchant is not on the mandate's allowlist"
    },
    {
      "code": 6001,
      "name": "exceedsPerPaymentLimit",
      "msg": "Payment exceeds the per-payment limit"
    },
    {
      "code": 6002,
      "name": "exceedsDailyLimit",
      "msg": "Payment would exceed the rolling 24-hour limit"
    },
    {
      "code": 6003,
      "name": "mandateExpired",
      "msg": "This mandate has expired"
    },
    {
      "code": 6004,
      "name": "mandateRevoked",
      "msg": "This mandate has been revoked"
    },
    {
      "code": 6005,
      "name": "notMandateAgent",
      "msg": "Signer is not the agent named in this mandate"
    },
    {
      "code": 6006,
      "name": "notMandateOwner",
      "msg": "Signer is not the owner of this mandate"
    },
    {
      "code": 6007,
      "name": "wrongMint",
      "msg": "Token mint does not match the mandate"
    },
    {
      "code": 6008,
      "name": "wrongVault",
      "msg": "Vault does not match the mandate"
    },
    {
      "code": 6009,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6010,
      "name": "invalidLimit",
      "msg": "Limits must be greater than zero and the daily limit at least the per-payment limit"
    },
    {
      "code": 6011,
      "name": "emptyMerchantList",
      "msg": "A mandate must allow at least one merchant"
    },
    {
      "code": 6012,
      "name": "tooManyMerchants",
      "msg": "Too many merchants for one mandate"
    },
    {
      "code": 6013,
      "name": "expiryInPast",
      "msg": "Expiry must be in the future"
    },
    {
      "code": 6014,
      "name": "taskIdTooLong",
      "msg": "Task id is too long"
    },
    {
      "code": 6015,
      "name": "insufficientVaultBalance",
      "msg": "Vault does not hold enough tokens"
    },
    {
      "code": 6016,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    }
  ],
  "types": [
    {
      "name": "mandate",
      "docs": [
        "A human's signed statement of what one agent may spend."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "docs": [
              "The human who created the mandate and owns the funds."
            ],
            "type": "pubkey"
          },
          {
            "name": "agent",
            "docs": [
              "The agent's signing key. Only this key may request payments."
            ],
            "type": "pubkey"
          },
          {
            "name": "mint",
            "docs": [
              "The token the mandate is denominated in (USDC in practice)."
            ],
            "type": "pubkey"
          },
          {
            "name": "vault",
            "docs": [
              "The vault token account holding the funds."
            ],
            "type": "pubkey"
          },
          {
            "name": "maxPerPayment",
            "docs": [
              "Ceiling on any single payment."
            ],
            "type": "u64"
          },
          {
            "name": "dailyLimit",
            "docs": [
              "Ceiling on total spend inside a rolling 24-hour window."
            ],
            "type": "u64"
          },
          {
            "name": "spentInWindow",
            "docs": [
              "Spend so far inside the current window."
            ],
            "type": "u64"
          },
          {
            "name": "windowStart",
            "docs": [
              "When the current window opened."
            ],
            "type": "i64"
          },
          {
            "name": "expiresAt",
            "docs": [
              "After this timestamp the mandate pays nothing."
            ],
            "type": "i64"
          },
          {
            "name": "revoked",
            "docs": [
              "Set by the owner to stop all payments immediately."
            ],
            "type": "bool"
          },
          {
            "name": "totalSpent",
            "docs": [
              "Lifetime spend, for reporting."
            ],
            "type": "u64"
          },
          {
            "name": "paymentCount",
            "docs": [
              "Lifetime payment count, for reporting."
            ],
            "type": "u64"
          },
          {
            "name": "merchants",
            "docs": [
              "Addresses this agent is allowed to pay."
            ],
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "mandateCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mandate",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "agent",
            "type": "pubkey"
          },
          {
            "name": "maxPerPayment",
            "type": "u64"
          },
          {
            "name": "dailyLimit",
            "type": "u64"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "mandateRevoked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mandate",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "paymentExecuted",
      "docs": [
        "Emitted on every successful payment. The indexer turns these into per-agent",
        "and per-task spend reporting."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mandate",
            "type": "pubkey"
          },
          {
            "name": "agent",
            "type": "pubkey"
          },
          {
            "name": "merchant",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "taskId",
            "type": "string"
          },
          {
            "name": "spentInWindow",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    }
  ]
};

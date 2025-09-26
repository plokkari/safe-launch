/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/cap_guard.json`.
 */
export type CapGuard = {
  "address": "C8RGfQJMVyUEGS9bMKoMnfvU1mZJYQ35dVdhxQSZ5iqr",
  "metadata": {
    "name": "capGuard",
    "version": "0.1.0",
    "spec": "0.1.0"
  },
  "instructions": [
    {
      "name": "guardedTransfer",
      "discriminator": [
        101,
        14,
        194,
        73,
        126,
        140,
        118,
        221
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true
        },
        {
          "name": "from",
          "writable": true
        },
        {
          "name": "destination",
          "writable": true
        },
        {
          "name": "mint"
        },
        {
          "name": "owner",
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
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
      "name": "initConfig",
      "discriminator": [
        23,
        235,
        115,
        232,
        168,
        96,
        1,
        231
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "signer": true
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "maxPercent",
          "type": "u8"
        }
      ]
    },
    {
      "name": "setGraduated",
      "discriminator": [
        195,
        104,
        1,
        112,
        166,
        85,
        22,
        115
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "graduated",
          "type": "bool"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "overCap",
      "msg": "Transfer exceeds max cap before graduation"
    },
    {
      "code": 6001,
      "name": "unauthorized",
      "msg": "Only authority may update this config"
    }
  ],
  "types": [
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "maxPercent",
            "type": "u8"
          },
          {
            "name": "graduated",
            "type": "bool"
          }
        ]
      }
    }
  ]
};

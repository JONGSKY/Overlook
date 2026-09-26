window.CITY = {
  "kind": "overlook.city/v1",
  "meta": {
    "repo": "clean-pass",
    "base": "010ae30c5a7bcc56629ab083134746532dbda140",
    "head": "891bed9eb2a5e55a588cc3424c81c440a2f58177",
    "refs": {
      "base": "main",
      "head": "agent/pay-17-checkout-rounding"
    },
    "src": ".",
    "generatedAt": "2026-09-19T11:09:00.000Z",
    "sample": true,
    "draft": false
  },
  "request": {
    "id": "PAY-17",
    "title": {
      "en": "Fix rounding in checkout total"
    },
    "scope": {
      "en": "Checkout total calculation and its tests"
    }
  },
  "bobReport": "Fixed rounding in the checkout total. Only checkout code changed. Added a test for half-cent totals.",
  "fence": {
    "paths": [
      "src/checkout/",
      "tests/checkout/"
    ],
    "rationale": {
      "en": "The ticket asks to \"fix rounding in the checkout total\"; the total is computed in src/checkout/ and tested in tests/checkout/."
    }
  },
  "districts": [
    {
      "id": "./",
      "path": "./",
      "label": {
        "en": "Project root"
      },
      "inFence": false
    },
    {
      "id": ".github/",
      "path": ".github/",
      "label": {
        "en": "CI pipelines"
      },
      "inFence": false
    },
    {
      "id": "server/",
      "path": "server/",
      "label": {
        "en": "Server"
      },
      "inFence": false
    },
    {
      "id": "src/",
      "path": "src/",
      "label": {
        "en": "App shell"
      },
      "inFence": false
    },
    {
      "id": "src/cart/",
      "path": "src/cart/",
      "label": {
        "en": "Cart"
      },
      "inFence": false
    },
    {
      "id": "src/checkout/",
      "path": "src/checkout/",
      "label": {
        "en": "Checkout"
      },
      "inFence": true
    },
    {
      "id": "src/products/",
      "path": "src/products/",
      "label": {
        "en": "Products"
      },
      "inFence": false
    },
    {
      "id": "src/shared/",
      "path": "src/shared/",
      "label": {
        "en": "Shared helpers"
      },
      "inFence": false
    },
    {
      "id": "tests/",
      "path": "tests/",
      "label": {
        "en": "Tests"
      },
      "inFence": false
    },
    {
      "id": "tests/checkout/",
      "path": "tests/checkout/",
      "label": {
        "en": "Checkout tests"
      },
      "inFence": true
    }
  ],
  "steps": [
    {
      "message": "Task received",
      "sha": null,
      "files": [],
      "outside": false
    },
    {
      "sha": "1fbc20394bba155c0e700805dc308fea5d1996a4",
      "message": "Round checkout total half up in whole cents",
      "author": "Sample Agent",
      "date": "2026-09-19T11:04:00.000Z",
      "files": [
        "src/checkout/total.ts"
      ],
      "changes": {
        "src/checkout/total.ts": {
          "plus": 15,
          "minus": 4,
          "diff": [
            [
              "h",
              "@@ -1,2 +1,2 @@"
            ],
            [
              "d",
              "import type { Money } from '../shared/money';"
            ],
            [
              "a",
              "import { fromCents, type Money } from '../shared/money';"
            ],
            [
              "c",
              "import type { CartLine } from '../cart/cartStore';"
            ],
            [
              "h",
              "@@ -19,5 +19,16 @@ export function checkoutTotal(lines: CartLine[], region: string, codes: string[]"
            ],
            [
              "c",
              "  const shipping = shippingFor(lines, region);"
            ],
            [
              "d",
              "  // Truncate to cents for display."
            ],
            [
              "d",
              "  const total = Math.floor((subtotal - discount + tax + shipping) * 100) / 100;"
            ],
            [
              "d",
              "  return { subtotal, discount, tax, shipping, total };"
            ],
            [
              "a",
              "  // Sum in whole cents, rounding each part half up, so 10.005 becomes 10.01 (not 10.00)."
            ],
            [
              "a",
              "  const cents = roundCents(subtotal) - roundCents(discount) + roundCents(tax) + roundCents(shipping);"
            ],
            [
              "a",
              "  return {"
            ],
            [
              "a",
              "    subtotal: fromCents(roundCents(subtotal)),"
            ],
            [
              "a",
              "    discount: fromCents(roundCents(discount)),"
            ],
            [
              "a",
              "    tax: fromCents(roundCents(tax)),"
            ],
            [
              "a",
              "    shipping: fromCents(roundCents(shipping)),"
            ],
            [
              "a",
              "    total: fromCents(cents),"
            ],
            [
              "a",
              "  };"
            ],
            [
              "a",
              "}"
            ],
            [
              "a",
              ""
            ],
            [
              "a",
              "// Half-up rounding to whole cents that is safe for binary floats (1.005 * 100 = 100.49999…)."
            ],
            [
              "a",
              "function roundCents(amount: Money): number {"
            ],
            [
              "a",
              "  return Math.round(Number((amount * 100).toFixed(6)));"
            ],
            [
              "c",
              "}"
            ]
          ]
        }
      },
      "outside": false
    },
    {
      "sha": "891bed9eb2a5e55a588cc3424c81c440a2f58177",
      "message": "Add checkout total tests for half-cent amounts",
      "author": "Sample Agent",
      "date": "2026-09-19T11:09:00.000Z",
      "files": [
        "tests/checkout/total.test.ts"
      ],
      "changes": {
        "tests/checkout/total.test.ts": {
          "plus": 11,
          "minus": 0,
          "diff": [
            [
              "h",
              "@@ -18,2 +18,13 @@ describe('checkoutTotal', () => {"
            ],
            [
              "c",
              "  });"
            ],
            [
              "a",
              ""
            ],
            [
              "a",
              "  it('rounds half-cent totals up', () => {"
            ],
            [
              "a",
              "    const t = checkoutTotal([line(10.005)], 'none');"
            ],
            [
              "a",
              "    expect(t.total).toBe(10.01);"
            ],
            [
              "a",
              "  });"
            ],
            [
              "a",
              ""
            ],
            [
              "a",
              "  it('does not lose a cent to float error', () => {"
            ],
            [
              "a",
              "    const t = checkoutTotal([line(1.005), line(0.1), line(0.2)], 'none');"
            ],
            [
              "a",
              "    expect(t.total).toBe(1.31);"
            ],
            [
              "a",
              "    expect(t.subtotal).toBe(1.31);"
            ],
            [
              "a",
              "  });"
            ],
            [
              "c",
              "});"
            ]
          ]
        }
      },
      "outside": false
    },
    {
      "message": "Done",
      "sha": null,
      "files": [],
      "outside": false
    }
  ],
  "graph": {
    "lanes": [
      {
        "id": "base",
        "name": "main",
        "kind": "base"
      },
      {
        "id": "head",
        "name": "agent/pay-17-checkout-rounding",
        "kind": "head"
      },
      {
        "id": "o1",
        "name": "feature/onboarding-copy",
        "kind": "other",
        "merged": false,
        "more": 0
      }
    ],
    "commits": [
      {
        "sha": "010ae30c5a7bcc56629ab083134746532dbda140",
        "parents": [],
        "date": "2026-09-18T09:00:00.000Z",
        "author": "Sample Maintainer",
        "message": "Corner Shop 1.8.2",
        "lane": "base",
        "files": [
          ".github/workflows/ci.yml",
          "README.md",
          "package.json",
          "server/db.ts",
          "server/index.ts",
          "server/routes/orders.ts",
          "server/routes/products.ts",
          "server/seed/products.json",
          "src/App.tsx",
          "src/cart/Cart.tsx",
          "src/cart/CartItem.tsx",
          "src/cart/cartStore.ts",
          "src/cart/useCart.ts",
          "src/checkout/CheckoutPage.tsx",
          "src/checkout/CheckoutSummary.tsx",
          "src/checkout/PaymentForm.tsx",
          "src/checkout/discounts.ts",
          "src/checkout/shipping.ts",
          "src/checkout/tax.ts",
          "src/checkout/total.ts",
          "src/main.tsx",
          "src/products/ProductCard.tsx",
          "src/products/ProductList.tsx",
          "src/products/ProductPage.tsx",
          "src/products/catalog.ts",
          "src/shared/format.ts",
          "src/shared/http.ts",
          "src/shared/money.ts",
          "tests/cart/cartStore.test.ts",
          "tests/checkout/shipping.test.ts",
          "tests/checkout/tax.test.ts",
          "tests/checkout/total.test.ts",
          "tests/products/catalog.test.ts",
          "tests/shared/money.test.ts",
          "tsconfig.json"
        ],
        "lines": [
          [
            12,
            0
          ],
          [
            9,
            0
          ],
          [
            21,
            0
          ],
          [
            16,
            0
          ],
          [
            9,
            0
          ],
          [
            10,
            0
          ],
          [
            11,
            0
          ],
          [
            146,
            0
          ],
          [
            12,
            0
          ],
          [
            19,
            0
          ],
          [
            13,
            0
          ],
          [
            31,
            0
          ],
          [
            6,
            0
          ],
          [
            32,
            0
          ],
          [
            23,
            0
          ],
          [
            17,
            0
          ],
          [
            16,
            0
          ],
          [
            13,
            0
          ],
          [
            8,
            0
          ],
          [
            23,
            0
          ],
          [
            4,
            0
          ],
          [
            18,
            0
          ],
          [
            17,
            0
          ],
          [
            18,
            0
          ],
          [
            14,
            0
          ],
          [
            7,
            0
          ],
          [
            11,
            0
          ],
          [
            14,
            0
          ],
          [
            10,
            0
          ],
          [
            8,
            0
          ],
          [
            11,
            0
          ],
          [
            19,
            0
          ],
          [
            10,
            0
          ],
          [
            8,
            0
          ],
          [
            4,
            0
          ]
        ],
        "peek": {
          ".github/workflows/ci.yml": [
            [
              "h",
              "@@ -0,0 +1,12 @@"
            ],
            [
              "a",
              "name: CI"
            ],
            [
              "a",
              "on: [pull_request]"
            ],
            [
              "a",
              "jobs:"
            ],
            [
              "a",
              "  test:"
            ],
            [
              "a",
              "    runs-on: ubuntu-latest"
            ]
          ],
          "README.md": [
            [
              "h",
              "@@ -0,0 +1,9 @@"
            ],
            [
              "a",
              "# Corner Shop"
            ],
            [
              "a",
              ""
            ],
            [
              "a",
              "A small web shop: product catalog, cart and checkout."
            ],
            [
              "a",
              ""
            ],
            [
              "a",
              "- `src/products/` — catalog"
            ]
          ],
          "package.json": [
            [
              "h",
              "@@ -0,0 +1,21 @@"
            ],
            [
              "a",
              "{"
            ],
            [
              "a",
              "  \"name\": \"corner-shop\","
            ],
            [
              "a",
              "  \"version\": \"1.8.2\","
            ],
            [
              "a",
              "  \"private\": true,"
            ],
            [
              "a",
              "  \"type\": \"module\","
            ]
          ],
          "server/db.ts": [
            [
              "h",
              "@@ -0,0 +1,16 @@"
            ],
            [
              "a",
              "export interface Row {"
            ],
            [
              "a",
              "  [key: string]: unknown;"
            ],
            [
              "a",
              "}"
            ],
            [
              "a",
              ""
            ],
            [
              "a",
              "const tables = new Map<string, Row[]>(["
            ]
          ]
        }
      },
      {
        "sha": "ccfbedd244c5b95928ec5bf1c9f07e2471abde30",
        "parents": [
          "010ae30c5a7bcc56629ab083134746532dbda140"
        ],
        "date": "2026-09-19T10:29:00.000Z",
        "author": "Sample Teammate",
        "message": "Start the changelog (#40)",
        "pr": 40,
        "lane": "base",
        "files": [
          "docs/CHANGELOG.md"
        ],
        "lines": [
          [
            1,
            0
          ]
        ],
        "peek": {
          "docs/CHANGELOG.md": [
            [
              "h",
              "@@ -0,0 +1 @@"
            ],
            [
              "a",
              "- Release notes for the next version."
            ]
          ]
        }
      },
      {
        "sha": "32232c2e5ddfa73c6ffd0ca2042b124b522e5d79",
        "parents": [
          "ccfbedd244c5b95928ec5bf1c9f07e2471abde30"
        ],
        "date": "2026-09-19T10:36:00.000Z",
        "author": "Sample Teammate",
        "message": "Draft onboarding welcome page",
        "lane": "o1",
        "files": [
          "docs/onboarding/welcome.md"
        ],
        "lines": [
          [
            1,
            0
          ]
        ],
        "peek": {
          "docs/onboarding/welcome.md": [
            [
              "h",
              "@@ -0,0 +1 @@"
            ],
            [
              "a",
              "# Welcome"
            ]
          ]
        }
      },
      {
        "sha": "6720e2bc6b0af2d759479c70f0d5775e33577385",
        "parents": [
          "32232c2e5ddfa73c6ffd0ca2042b124b522e5d79"
        ],
        "date": "2026-09-19T10:43:00.000Z",
        "author": "Sample Teammate",
        "message": "Onboarding: first steps",
        "lane": "o1",
        "files": [
          "docs/onboarding/welcome.md"
        ],
        "lines": [
          [
            1,
            0
          ]
        ],
        "peek": {
          "docs/onboarding/welcome.md": [
            [
              "h",
              "@@ -1,0 +2 @@"
            ],
            [
              "a",
              "Start with the README, then run the tests."
            ]
          ]
        }
      },
      {
        "sha": "1fbc20394bba155c0e700805dc308fea5d1996a4",
        "parents": [
          "010ae30c5a7bcc56629ab083134746532dbda140"
        ],
        "date": "2026-09-19T11:04:00.000Z",
        "author": "Sample Agent",
        "message": "Round checkout total half up in whole cents",
        "lane": "head",
        "step": 1
      },
      {
        "sha": "891bed9eb2a5e55a588cc3424c81c440a2f58177",
        "parents": [
          "1fbc20394bba155c0e700805dc308fea5d1996a4"
        ],
        "date": "2026-09-19T11:09:00.000Z",
        "author": "Sample Agent",
        "message": "Add checkout total tests for half-cent amounts",
        "lane": "head",
        "step": 2
      }
    ]
  },
  "files": [
    {
      "path": ".github/workflows/ci.yml",
      "status": "unchanged",
      "locBefore": 12,
      "locAfter": 12,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": false,
      "isApi": false,
      "importedBy": [],
      "diff": [],
      "test": null,
      "name": "ci.yml",
      "district": ".github/",
      "inFence": false,
      "kind": "none",
      "item": null,
      "causes": []
    },
    {
      "path": "README.md",
      "status": "unchanged",
      "locBefore": 7,
      "locAfter": 7,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": false,
      "isApi": false,
      "importedBy": [],
      "diff": [],
      "test": null,
      "name": "README.md",
      "district": "./",
      "inFence": false,
      "kind": "none",
      "item": null,
      "causes": []
    },
    {
      "path": "package.json",
      "status": "unchanged",
      "locBefore": 21,
      "locAfter": 21,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": false,
      "isApi": false,
      "importedBy": [],
      "diff": [],
      "test": null,
      "name": "package.json",
      "district": "./",
      "inFence": false,
      "kind": "none",
      "item": null,
      "causes": []
    },
    {
      "path": "server/db.ts",
      "status": "unchanged",
      "locBefore": 14,
      "locAfter": 14,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": false,
      "isApi": false,
      "importedBy": [
        "server/routes/orders.ts",
        "server/routes/products.ts"
      ],
      "diff": [],
      "test": null,
      "name": "db.ts",
      "district": "server/",
      "inFence": false,
      "kind": "none",
      "item": null,
      "causes": []
    },
    {
      "path": "server/index.ts",
      "status": "unchanged",
      "locBefore": 8,
      "locAfter": 8,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": false,
      "isApi": false,
      "importedBy": [],
      "diff": [],
      "test": null,
      "name": "index.ts",
      "district": "server/",
      "inFence": false,
      "kind": "none",
      "item": null,
      "causes": []
    },
    {
      "path": "server/routes/orders.ts",
      "status": "unchanged",
      "locBefore": 8,
      "locAfter": 8,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": false,
      "isApi": true,
      "importedBy": [
        "server/index.ts"
      ],
      "diff": [],
      "test": null,
      "name": "orders.ts",
      "district": "server/",
      "inFence": false,
      "kind": "none",
      "item": null,
      "causes": []
    },
    {
      "path": "server/routes/products.ts",
      "status": "unchanged",
      "locBefore": 9,
      "locAfter": 9,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": false,
      "isApi": true,
      "importedBy": [
        "server/index.ts"
      ],
      "diff": [],
      "test": null,
      "name": "products.ts",
      "district": "server/",
      "inFence": false,
      "kind": "none",
      "item": null,
      "causes": []
    },
    {
      "path": "server/seed/products.json",
      "status": "unchanged",
      "locBefore": 146,
      "locAfter": 146,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": false,
      "isApi": false,
      "importedBy": [],
      "diff": [],
      "test": null,
      "name": "products.json",
      "district": "server/",
      "inFence": false,
      "kind": "none",
      "item": null,
      "causes": []
    },
    {
      "path": "src/App.tsx",
      "status": "unchanged",
      "locBefore": 11,
      "locAfter": 11,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": false,
      "isApi": false,
      "importedBy": [
        "src/main.tsx"
      ],
      "diff": [],
      "test": null,
      "name": "App.tsx",
      "district": "src/",
      "inFence": false,
      "kind": "none",
      "item": null,
      "causes": []
    },
    {
      "path": "src/cart/Cart.tsx",
      "status": "unchanged",
      "locBefore": 18,
      "locAfter": 18,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": false,
      "isApi": false,
      "importedBy": [
        "src/App.tsx"
      ],
      "diff": [],
      "test": null,
      "name": "Cart.tsx",
      "district": "src/cart/",
      "inFence": false,
      "kind": "none",
      "item": null,
      "causes": []
    },
    {
      "path": "src/cart/CartItem.tsx",
      "status": "unchanged",
      "locBefore": 12,
      "locAfter": 12,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": false,
      "isApi": false,
      "importedBy": [
        "src/cart/Cart.tsx"
      ],
      "diff": [],
      "test": null,
      "name": "CartItem.tsx",
      "district": "src/cart/",
      "inFence": false,
      "kind": "none",
      "item": null,
      "causes": []
    },
    {
      "path": "src/cart/cartStore.ts",
      "status": "unchanged",
      "locBefore": 28,
      "locAfter": 28,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": false,
      "isApi": false,
      "importedBy": [
        "src/cart/CartItem.tsx",
        "src/cart/useCart.ts",
        "src/checkout/shipping.ts",
        "src/checkout/total.ts",
        "src/products/ProductCard.tsx",
        "tests/cart/cartStore.test.ts"
      ],
      "diff": [],
      "test": null,
      "name": "cartStore.ts",
      "district": "src/cart/",
      "inFence": false,
      "kind": "none",
      "item": null,
      "causes": []
    },
    {
      "path": "src/cart/useCart.ts",
      "status": "unchanged",
      "locBefore": 5,
      "locAfter": 5,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": false,
      "isApi": false,
      "importedBy": [
        "src/cart/Cart.tsx",
        "src/checkout/CheckoutPage.tsx"
      ],
      "diff": [],
      "test": null,
      "name": "useCart.ts",
      "district": "src/cart/",
      "inFence": false,
      "kind": "none",
      "item": null,
      "causes": []
    },
    {
      "path": "src/checkout/CheckoutPage.tsx",
      "status": "unchanged",
      "locBefore": 31,
      "locAfter": 31,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": false,
      "isApi": false,
      "importedBy": [
        "src/App.tsx"
      ],
      "uses": {
        "src/checkout/total.ts": "import { checkoutTotal } from './total';"
      },
      "diff": [],
      "test": null,
      "name": "CheckoutPage.tsx",
      "district": "src/checkout/",
      "inFence": true,
      "kind": "none",
      "item": null,
      "causes": []
    },
    {
      "path": "src/checkout/CheckoutSummary.tsx",
      "status": "unchanged",
      "locBefore": 22,
      "locAfter": 22,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": false,
      "isApi": false,
      "importedBy": [
        "src/checkout/CheckoutPage.tsx"
      ],
      "uses": {
        "src/checkout/total.ts": "import type { CheckoutTotal } from './total';"
      },
      "diff": [],
      "test": null,
      "name": "CheckoutSummary.tsx",
      "district": "src/checkout/",
      "inFence": true,
      "kind": "none",
      "item": null,
      "causes": []
    },
    {
      "path": "src/checkout/PaymentForm.tsx",
      "status": "unchanged",
      "locBefore": 16,
      "locAfter": 16,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": false,
      "isApi": false,
      "importedBy": [
        "src/checkout/CheckoutPage.tsx"
      ],
      "uses": {
        "src/checkout/total.ts": "import type { CheckoutTotal } from './total';"
      },
      "diff": [],
      "test": null,
      "name": "PaymentForm.tsx",
      "district": "src/checkout/",
      "inFence": true,
      "kind": "none",
      "item": null,
      "causes": []
    },
    {
      "path": "src/checkout/discounts.ts",
      "status": "unchanged",
      "locBefore": 14,
      "locAfter": 14,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": false,
      "isApi": false,
      "importedBy": [
        "src/checkout/total.ts"
      ],
      "diff": [],
      "test": null,
      "name": "discounts.ts",
      "district": "src/checkout/",
      "inFence": true,
      "kind": "none",
      "item": null,
      "causes": []
    },
    {
      "path": "src/checkout/shipping.ts",
      "status": "unchanged",
      "locBefore": 11,
      "locAfter": 11,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": false,
      "isApi": false,
      "importedBy": [
        "src/checkout/total.ts",
        "tests/checkout/shipping.test.ts"
      ],
      "diff": [],
      "test": null,
      "name": "shipping.ts",
      "district": "src/checkout/",
      "inFence": true,
      "kind": "none",
      "item": null,
      "causes": []
    },
    {
      "path": "src/checkout/tax.ts",
      "status": "unchanged",
      "locBefore": 6,
      "locAfter": 6,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": false,
      "isApi": false,
      "importedBy": [
        "src/checkout/total.ts",
        "tests/checkout/tax.test.ts"
      ],
      "diff": [],
      "test": null,
      "name": "tax.ts",
      "district": "src/checkout/",
      "inFence": true,
      "kind": "none",
      "item": null,
      "causes": []
    },
    {
      "path": "src/checkout/total.ts",
      "status": "modified",
      "locBefore": 21,
      "locAfter": 31,
      "plus": 15,
      "minus": 4,
      "step": 1,
      "isTest": false,
      "isApi": false,
      "importedBy": [
        "src/checkout/CheckoutPage.tsx",
        "src/checkout/CheckoutSummary.tsx",
        "src/checkout/PaymentForm.tsx",
        "tests/checkout/total.test.ts"
      ],
      "diff": [
        [
          "h",
          "@@ -1,2 +1,2 @@"
        ],
        [
          "d",
          "import type { Money } from '../shared/money';"
        ],
        [
          "a",
          "import { fromCents, type Money } from '../shared/money';"
        ],
        [
          "c",
          "import type { CartLine } from '../cart/cartStore';"
        ],
        [
          "h",
          "@@ -19,5 +19,16 @@ export function checkoutTotal(lines: CartLine[], region: string, codes: string[]"
        ],
        [
          "c",
          "  const shipping = shippingFor(lines, region);"
        ],
        [
          "d",
          "  // Truncate to cents for display."
        ],
        [
          "d",
          "  const total = Math.floor((subtotal - discount + tax + shipping) * 100) / 100;"
        ],
        [
          "d",
          "  return { subtotal, discount, tax, shipping, total };"
        ],
        [
          "a",
          "  // Sum in whole cents, rounding each part half up, so 10.005 becomes 10.01 (not 10.00)."
        ],
        [
          "a",
          "  const cents = roundCents(subtotal) - roundCents(discount) + roundCents(tax) + roundCents(shipping);"
        ],
        [
          "a",
          "  return {"
        ],
        [
          "a",
          "    subtotal: fromCents(roundCents(subtotal)),"
        ],
        [
          "a",
          "    discount: fromCents(roundCents(discount)),"
        ],
        [
          "a",
          "    tax: fromCents(roundCents(tax)),"
        ],
        [
          "a",
          "    shipping: fromCents(roundCents(shipping)),"
        ],
        [
          "a",
          "    total: fromCents(cents),"
        ],
        [
          "a",
          "  };"
        ],
        [
          "a",
          "}"
        ],
        [
          "a",
          ""
        ],
        [
          "a",
          "// Half-up rounding to whole cents that is safe for binary floats (1.005 * 100 = 100.49999…)."
        ],
        [
          "a",
          "function roundCents(amount: Money): number {"
        ],
        [
          "a",
          "  return Math.round(Number((amount * 100).toFixed(6)));"
        ],
        [
          "c",
          "}"
        ]
      ],
      "test": null,
      "name": "total.ts",
      "district": "src/checkout/",
      "inFence": true,
      "kind": "in",
      "item": null,
      "causes": []
    },
    {
      "path": "src/main.tsx",
      "status": "unchanged",
      "locBefore": 3,
      "locAfter": 3,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": false,
      "isApi": false,
      "importedBy": [],
      "diff": [],
      "test": null,
      "name": "main.tsx",
      "district": "src/",
      "inFence": false,
      "kind": "none",
      "item": null,
      "causes": []
    },
    {
      "path": "src/products/ProductCard.tsx",
      "status": "unchanged",
      "locBefore": 17,
      "locAfter": 17,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": false,
      "isApi": false,
      "importedBy": [
        "src/products/ProductList.tsx"
      ],
      "diff": [],
      "test": null,
      "name": "ProductCard.tsx",
      "district": "src/products/",
      "inFence": false,
      "kind": "none",
      "item": null,
      "causes": []
    },
    {
      "path": "src/products/ProductList.tsx",
      "status": "unchanged",
      "locBefore": 16,
      "locAfter": 16,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": false,
      "isApi": false,
      "importedBy": [
        "src/App.tsx"
      ],
      "diff": [],
      "test": null,
      "name": "ProductList.tsx",
      "district": "src/products/",
      "inFence": false,
      "kind": "none",
      "item": null,
      "causes": []
    },
    {
      "path": "src/products/ProductPage.tsx",
      "status": "unchanged",
      "locBefore": 17,
      "locAfter": 17,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": false,
      "isApi": false,
      "importedBy": [
        "src/App.tsx"
      ],
      "diff": [],
      "test": null,
      "name": "ProductPage.tsx",
      "district": "src/products/",
      "inFence": false,
      "kind": "none",
      "item": null,
      "causes": []
    },
    {
      "path": "src/products/catalog.ts",
      "status": "unchanged",
      "locBefore": 12,
      "locAfter": 12,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": false,
      "isApi": false,
      "importedBy": [
        "src/products/ProductCard.tsx",
        "src/products/ProductList.tsx",
        "src/products/ProductPage.tsx",
        "tests/products/catalog.test.ts"
      ],
      "diff": [],
      "test": null,
      "name": "catalog.ts",
      "district": "src/products/",
      "inFence": false,
      "kind": "none",
      "item": null,
      "causes": []
    },
    {
      "path": "src/shared/format.ts",
      "status": "unchanged",
      "locBefore": 6,
      "locAfter": 6,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": false,
      "isApi": false,
      "importedBy": [
        "src/cart/Cart.tsx",
        "src/products/ProductCard.tsx"
      ],
      "diff": [],
      "test": null,
      "name": "format.ts",
      "district": "src/shared/",
      "inFence": false,
      "kind": "none",
      "item": null,
      "causes": []
    },
    {
      "path": "src/shared/http.ts",
      "status": "unchanged",
      "locBefore": 10,
      "locAfter": 10,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": false,
      "isApi": false,
      "importedBy": [
        "src/checkout/PaymentForm.tsx",
        "src/products/catalog.ts"
      ],
      "diff": [],
      "test": null,
      "name": "http.ts",
      "district": "src/shared/",
      "inFence": false,
      "kind": "none",
      "item": null,
      "causes": []
    },
    {
      "path": "src/shared/money.ts",
      "status": "unchanged",
      "locBefore": 11,
      "locAfter": 11,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": false,
      "isApi": false,
      "importedBy": [
        "src/cart/CartItem.tsx",
        "src/cart/cartStore.ts",
        "src/checkout/CheckoutSummary.tsx",
        "src/checkout/discounts.ts",
        "src/checkout/shipping.ts",
        "src/checkout/tax.ts",
        "src/checkout/total.ts",
        "src/products/ProductCard.tsx",
        "src/products/ProductPage.tsx",
        "src/products/catalog.ts",
        "tests/shared/money.test.ts"
      ],
      "diff": [],
      "test": null,
      "name": "money.ts",
      "district": "src/shared/",
      "inFence": false,
      "kind": "none",
      "item": null,
      "causes": []
    },
    {
      "path": "tests/cart/cartStore.test.ts",
      "status": "unchanged",
      "locBefore": 9,
      "locAfter": 9,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": true,
      "isApi": false,
      "importedBy": [],
      "diff": [],
      "test": null,
      "name": "cartStore.test.ts",
      "district": "tests/",
      "inFence": false,
      "kind": "none",
      "item": null,
      "causes": []
    },
    {
      "path": "tests/checkout/shipping.test.ts",
      "status": "unchanged",
      "locBefore": 7,
      "locAfter": 7,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": true,
      "isApi": false,
      "importedBy": [],
      "diff": [],
      "test": null,
      "name": "shipping.test.ts",
      "district": "tests/checkout/",
      "inFence": true,
      "kind": "none",
      "item": null,
      "causes": []
    },
    {
      "path": "tests/checkout/tax.test.ts",
      "status": "unchanged",
      "locBefore": 10,
      "locAfter": 10,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": true,
      "isApi": false,
      "importedBy": [],
      "diff": [],
      "test": null,
      "name": "tax.test.ts",
      "district": "tests/checkout/",
      "inFence": true,
      "kind": "none",
      "item": null,
      "causes": []
    },
    {
      "path": "tests/checkout/total.test.ts",
      "status": "modified",
      "locBefore": 16,
      "locAfter": 25,
      "plus": 11,
      "minus": 0,
      "step": 2,
      "isTest": true,
      "isApi": false,
      "importedBy": [],
      "uses": {
        "src/checkout/total.ts": "import { checkoutTotal } from '../../src/checkout/total';"
      },
      "diff": [
        [
          "h",
          "@@ -18,2 +18,13 @@ describe('checkoutTotal', () => {"
        ],
        [
          "c",
          "  });"
        ],
        [
          "a",
          ""
        ],
        [
          "a",
          "  it('rounds half-cent totals up', () => {"
        ],
        [
          "a",
          "    const t = checkoutTotal([line(10.005)], 'none');"
        ],
        [
          "a",
          "    expect(t.total).toBe(10.01);"
        ],
        [
          "a",
          "  });"
        ],
        [
          "a",
          ""
        ],
        [
          "a",
          "  it('does not lose a cent to float error', () => {"
        ],
        [
          "a",
          "    const t = checkoutTotal([line(1.005), line(0.1), line(0.2)], 'none');"
        ],
        [
          "a",
          "    expect(t.total).toBe(1.31);"
        ],
        [
          "a",
          "    expect(t.subtotal).toBe(1.31);"
        ],
        [
          "a",
          "  });"
        ],
        [
          "c",
          "});"
        ]
      ],
      "test": {
        "assertionsRemoved": 0,
        "assertionsAdded": 3,
        "skipsAdded": 0,
        "rewritten": false,
        "weakened": false
      },
      "name": "total.test.ts",
      "district": "tests/checkout/",
      "inFence": true,
      "kind": "in",
      "item": null,
      "causes": []
    },
    {
      "path": "tests/products/catalog.test.ts",
      "status": "unchanged",
      "locBefore": 8,
      "locAfter": 8,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": true,
      "isApi": false,
      "importedBy": [],
      "diff": [],
      "test": null,
      "name": "catalog.test.ts",
      "district": "tests/",
      "inFence": false,
      "kind": "none",
      "item": null,
      "causes": []
    },
    {
      "path": "tests/shared/money.test.ts",
      "status": "unchanged",
      "locBefore": 7,
      "locAfter": 7,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": true,
      "isApi": false,
      "importedBy": [],
      "diff": [],
      "test": null,
      "name": "money.test.ts",
      "district": "tests/",
      "inFence": false,
      "kind": "none",
      "item": null,
      "causes": []
    },
    {
      "path": "tsconfig.json",
      "status": "unchanged",
      "locBefore": 4,
      "locAfter": 4,
      "plus": 0,
      "minus": 0,
      "step": null,
      "isTest": false,
      "isApi": false,
      "importedBy": [],
      "diff": [],
      "test": null,
      "name": "tsconfig.json",
      "district": "./",
      "inFence": false,
      "kind": "none",
      "item": null,
      "causes": []
    }
  ],
  "items": [],
  "claims": [
    {
      "text": "Fixed rounding in the checkout total.",
      "type": "feature",
      "verdict": "true",
      "detail": {
        "en": "The total is now summed in whole cents with half-up rounding, so a €10.005 cart totals €10.01 instead of €10.00."
      },
      "evidence": [
        "bob-judgement"
      ]
    },
    {
      "text": "Only checkout code changed.",
      "type": "scope",
      "verdict": "true",
      "detail": "All 2 changed file(s) are inside the request fence.",
      "evidence": [
        "git-diff"
      ]
    },
    {
      "text": "Added a test for half-cent totals.",
      "type": "feature",
      "verdict": "true",
      "detail": {
        "en": "tests/checkout/total.test.ts gains two cases with three new assertions; none were removed, loosened or skipped."
      },
      "evidence": [
        "bob-judgement"
      ]
    }
  ],
  "screens": [
    {
      "file": "src/checkout/total.ts",
      "label": {
        "en": "Checkout · requested"
      },
      "title": {
        "en": "Order total"
      },
      "who": {
        "en": "Shoppers at checkout"
      },
      "before": {
        "en": "Cart of €10.005 → Total €10.00"
      },
      "after": {
        "en": "Cart of €10.005 → Total €10.01"
      }
    }
  ],
  "plain": {
    "src/checkout/total.ts": {
      "title": {
        "en": "Checkout total rounds half-cents up"
      },
      "detail": {
        "en": "A €10.005 cart now totals €10.01 instead of €10.00. This was requested."
      }
    },
    "tests/checkout/total.test.ts": {
      "title": {
        "en": "Two new checks for half-cent totals"
      },
      "detail": {
        "en": "Adds three assertions; nothing was removed or loosened."
      }
    }
  },
  "totals": {
    "filesChanged": 2,
    "outside": 0,
    "affected": 0,
    "apiChanges": 0,
    "testsRewritten": 0,
    "claimsTrue": 3,
    "claims": 3
  }
};

export const SIMPLE_CARD_ELEMENT_OPTIONS = Object.freeze({
  layout: "tabs",
  paymentMethodOrder: ["card"],
  wallets: Object.freeze({
    applePay: "never",
    googlePay: "never",
    link: "never",
  }),
  fields: Object.freeze({
    billingDetails: Object.freeze({
      address: Object.freeze({ country: "never" }),
    }),
  }),
  defaultValues: Object.freeze({
    billingDetails: Object.freeze({
      address: Object.freeze({ country: "US" }),
    }),
  }),
});

export function simpleCardConfirmParams(returnUrl) {
  return {
    return_url: returnUrl,
    payment_method_data: {
      billing_details: {
        address: { country: "US" },
      },
    },
  };
}

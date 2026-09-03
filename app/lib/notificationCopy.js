export const PUSH_NOTIFICATION_COPY = Object.freeze({
  lead: Object.freeze({ title: "New lead", body: "A new lead is ready to review." }),
  emergencyLead: Object.freeze({ title: "Emergency service request", body: "A caller needs help as soon as possible. Open Contacted You to review the request." }),
  message: Object.freeze({ title: "New message", body: "You received a new customer message." }),
  helpUpdate: Object.freeze({ title: "New help update", body: "There is an update to your help request." }),
  paymentFailed: Object.freeze({ title: "Payment method update needed", body: "You need to update your payment method." }),
  paymentRestored: Object.freeze({ title: "Payment complete", body: "Your ARK services are active again." }),
  numberAssigned: Object.freeze({ title: "Your number is ready", body: "Your ARK receptionist number has been assigned." }),
});

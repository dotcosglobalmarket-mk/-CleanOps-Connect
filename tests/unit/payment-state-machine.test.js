const {
  STATES,
  EVENTS,
  transition,
  isTerminal,
  PaymentStateError,
} = require('../../src/services/payment-state-machine');

describe('payment-state-machine', () => {
  it('moves a fresh job from null to BOOKED on BOOK', () => {
    const job = {};
    transition(job, EVENTS.BOOK);
    expect(job.paymentStatus).toBe(STATES.BOOKED);
  });

  it('walks the happy path BOOKED -> PAID_HELD -> IN_PROGRESS -> AWAITING_CONFIRMATION -> CONFIRMED -> PAYOUT_PENDING -> PAID_OUT', () => {
    const job = { paymentStatus: STATES.BOOKED };
    transition(job, EVENTS.PAYMENT_SUCCEEDED);
    expect(job.paymentStatus).toBe(STATES.PAID_HELD);
    transition(job, EVENTS.CHECK_IN);
    expect(job.paymentStatus).toBe(STATES.IN_PROGRESS);
    transition(job, EVENTS.MARK_COMPLETE);
    expect(job.paymentStatus).toBe(STATES.AWAITING_CONFIRMATION);
    transition(job, EVENTS.CONFIRM);
    expect(job.paymentStatus).toBe(STATES.CONFIRMED);
    transition(job, EVENTS.CALCULATE_SPLIT);
    expect(job.paymentStatus).toBe(STATES.PAYOUT_PENDING);
    transition(job, EVENTS.TRANSFER_PAID);
    expect(job.paymentStatus).toBe(STATES.PAID_OUT);
  });

  it('rejects an event that is not valid from the current state', () => {
    const job = { paymentStatus: STATES.BOOKED };
    expect(() => transition(job, EVENTS.CONFIRM)).toThrow(PaymentStateError);
    expect(job.paymentStatus).toBe(STATES.BOOKED);
  });

  it('routes PAYOUT_PENDING through TRANSFER_FAILED to MANUAL_REVIEW_HOLD then PAID_OUT', () => {
    const job = { paymentStatus: STATES.PAYOUT_PENDING };
    transition(job, EVENTS.TRANSFER_ERROR);
    expect(job.paymentStatus).toBe(STATES.TRANSFER_FAILED);
    transition(job, EVENTS.ESCALATE_MANUAL);
    expect(job.paymentStatus).toBe(STATES.MANUAL_REVIEW_HOLD);
    transition(job, EVENTS.TRANSFER_PAID);
    expect(job.paymentStatus).toBe(STATES.PAID_OUT);
  });

  it('routes PAYOUT_PENDING through PAYOUT_BLOCKED back to PAYOUT_PENDING on recheck', () => {
    const job = { paymentStatus: STATES.PAYOUT_PENDING };
    transition(job, EVENTS.BLOCK_PAYOUT);
    expect(job.paymentStatus).toBe(STATES.PAYOUT_BLOCKED);
    transition(job, EVENTS.RECHECK_PAYOUT);
    expect(job.paymentStatus).toBe(STATES.PAYOUT_PENDING);
  });

  it('never allows TRANSFER_FAILED or MANUAL_REVIEW_HOLD to transition into a refund state', () => {
    const failed = { paymentStatus: STATES.TRANSFER_FAILED };
    expect(() => transition(failed, EVENTS.REFUND_DONE)).toThrow(PaymentStateError);

    const manualHold = { paymentStatus: STATES.MANUAL_REVIEW_HOLD };
    expect(() => transition(manualHold, EVENTS.REFUND_DONE)).toThrow(PaymentStateError);
  });

  it('marks PAID_OUT, REFUNDED, CANCELLED and PARTIALLY_REFUNDED as terminal', () => {
    expect(isTerminal(STATES.PAID_OUT)).toBe(true);
    expect(isTerminal(STATES.REFUNDED)).toBe(true);
    expect(isTerminal(STATES.CANCELLED)).toBe(true);
    expect(isTerminal(STATES.PARTIALLY_REFUNDED)).toBe(true);
    expect(isTerminal(STATES.BOOKED)).toBe(false);
  });
});

import { customerGet, customerSend } from '@/lib/api/customer';
import type { RequestOptions } from '@/lib/api/request';
import { DetailsSchema, type CustomerDetails } from './schemas';

/** The session customer's own details (S3). */
export function fetchDetails(options: RequestOptions = {}): Promise<CustomerDetails> {
  return customerGet('/customer/details', DetailsSchema, undefined, options);
}

/**
 * Saves Name + mobile exactly as typed: the backend trims, validates and
 * normalizes them (no OTP, F1-17). Saving supersedes any open review.
 */
export function saveDetails(name: string, mobile: string): Promise<CustomerDetails> {
  return customerSend('/customer/details', 'PUT', DetailsSchema, { json: { name, mobile } });
}

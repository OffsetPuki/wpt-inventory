import 'dotenv/config';
import { DEFAULT_BUSINESS_TIME_ZONE, businessDate } from '../shared/business-time';
export const businessTimeZone=process.env.BUSINESS_TIME_ZONE||DEFAULT_BUSINESS_TIME_ZONE;
// Fail startup on a misspelled zone; silently switching financial days is unsafe.
businessDate(Date.now(),businessTimeZone);
// Legacy payroll date arithmetic must use the same configured zone.
process.env.TZ=businessTimeZone;
export const businessDay=(ms=Date.now())=>businessDate(ms,businessTimeZone);

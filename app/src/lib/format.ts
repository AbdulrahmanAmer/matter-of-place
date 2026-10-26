import { siteConfig } from "../config/site";

/** Locale used for number formatting per currency; English default, localisation-ready. */
const localeForCurrency: Record<string, string> = {
  USD: "en-US",
  EUR: "de-DE",
  GBP: "en-GB",
  AED: "en-AE",
  EGP: "en-EG",
};

export const formatMoney = (amount: number, currency: string) =>
  new Intl.NumberFormat(localeForCurrency[currency] ?? siteConfig.locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);

/** An amount as an invoice states it: whole dollars, or cents when it has them ("$1,250" and "$250.50"). */
export function formatInvoiceMoney(amount: number, currency: string): string {
  const cents = Math.round(amount * 100) % 100 !== 0;
  return new Intl.NumberFormat(localeForCurrency[currency] ?? siteConfig.locale, {
    style: "currency",
    currency,
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export const formatNumber = (value: number) =>
  new Intl.NumberFormat(siteConfig.locale).format(value);

/** A calendar day ("2026-10-08", a report's week) as it is, without moving it to another zone's evening. */
export const formatCalendarDay = (date: string) =>
  new Intl.DateTimeFormat(siteConfig.locale, { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(date),
  );

/** Two-digit counters for editorial pagination ("01 / 06"). */
export const padIndex = (value: number) => String(value).padStart(2, "0");

/** The day as a heading says it, in the reader's own time zone: "Monday, October 12". */
export const formatWeekday = (at: number) =>
  new Intl.DateTimeFormat(siteConfig.locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(at);

export const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  count === 1 ? singular : plural;

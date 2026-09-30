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

export const formatNumber = (value: number) =>
  new Intl.NumberFormat(siteConfig.locale).format(value);

/** Two-digit counters for editorial pagination ("01 / 06"). */
export const padIndex = (value: number) => String(value).padStart(2, "0");

export const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  count === 1 ? singular : plural;

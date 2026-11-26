/** https://reproducible-builds.org/specs/source-date-epoch/ */
export function getSourceDate(): Date | undefined {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  if (!epoch) {
    return;
  }
  const date = new Date(Number(epoch) * 1000);
  if (!/^\d+$/.test(epoch) || Number.isNaN(date.getTime())) {
    throw new Error(
      `Invalid \`SOURCE_DATE_EPOCH\`: ${JSON.stringify(epoch)}. Expected the number of seconds since 1970-01-01.`
    );
  }
  return date;
}

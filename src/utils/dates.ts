export const isDateWithinNextTwoMonths = (value: string | undefined | null): boolean => {
  if (!value) {
    return false;
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return false;
  }

  const now = new Date();
  const maxDate = new Date(now);
  maxDate.setMonth(now.getMonth() + 2);

  return parsedDate >= now && parsedDate <= maxDate;
};


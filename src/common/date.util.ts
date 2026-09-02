/** Calendar date at UTC midnight (avoids Prisma @db.Date timezone drift). */
export function calendarDateOnly(d = new Date()): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

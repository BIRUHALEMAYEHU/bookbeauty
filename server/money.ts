/** Money helpers — store integer santim (1 ETB = 100 santim). */

export function etbToSantim(etb: number) {
  return Math.round(Number(etb) * 100);
}

export function santimToEtb(santim: number) {
  return Number(santim) / 100;
}

export function formatEtb(santim: number) {
  return `${santimToEtb(santim).toLocaleString('en-ET', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })} ETB`;
}

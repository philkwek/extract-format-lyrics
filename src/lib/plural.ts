export function songCount(n: number): string {
  return `${n} ${n === 1 ? 'song' : 'songs'}`
}

export function fitCaption(columns: number, fontSizePx: number): string {
  const columnLabel = columns === 1 ? 'column' : 'columns'
  return `Fits the screen · ${columns} ${columnLabel} · text size ${fontSizePx}`
}

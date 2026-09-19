/**
 * Katalog chipów, z których składa się opis stylu. Użytkownik nie pisze promptu
 * o „bokeh” i „volumetric lighting” — klika w gotowe określenia po polsku,
 * a my zamieniamy je na fragment promptu.
 *
 * Wartość `prompt` to dokładnie to, co pojedzie do modelu.
 */
export const CHIP_GROUPS = [
  {
    key: 'kind',
    label: 'Rodzaj',
    help: 'Czym to ma być z wyglądu.',
    options: [
      { value: 'fotografia', label: 'fotografia', prompt: 'zdjęcie fotograficzne' },
      { value: 'ilustracja', label: 'ilustracja', prompt: 'ilustracja rysowana' },
      { value: '3d', label: '3D / render', prompt: 'render 3D' },
      { value: 'flat', label: 'flat / wektor', prompt: 'płaska grafika wektorowa' },
      { value: 'akwarela', label: 'akwarela', prompt: 'malowane akwarelą' },
      { value: 'kolaz', label: 'kolaż', prompt: 'kolaż z wycinanych elementów' },
      { value: 'plakat', label: 'plakat', prompt: 'grafika plakatowa' },
    ],
  },
  {
    key: 'light',
    label: 'Światło',
    help: 'Najmocniej decyduje o nastroju zdjęcia.',
    options: [
      { value: 'miekkie', label: 'miękkie dzienne', prompt: 'miękkie światło dzienne' },
      { value: 'zlota-godzina', label: 'złota godzina', prompt: 'ciepłe światło złotej godziny' },
      { value: 'studyjne', label: 'studyjne', prompt: 'równe światło studyjne' },
      { value: 'neon', label: 'neon', prompt: 'neonowe światło, wyraźna poświata' },
      { value: 'kontrastowe', label: 'mocny kontrast', prompt: 'twarde, kontrastowe światło z głębokimi cieniami' },
      { value: 'mrok', label: 'mrok', prompt: 'ciemna scena, światło tylko na najważniejszym elemencie' },
    ],
  },
  {
    key: 'framing',
    label: 'Kadr',
    help: 'Jak blisko i z której strony patrzymy.',
    options: [
      { value: 'zblizenie', label: 'zbliżenie', prompt: 'kadr w zbliżeniu' },
      { value: 'szeroki', label: 'plan szeroki', prompt: 'szeroki plan' },
      { value: 'flat-lay', label: 'flat lay', prompt: 'ujęcie flat lay, przedmioty ułożone na płasko' },
      { value: 'z-gory', label: 'z góry', prompt: 'ujęcie z góry' },
      { value: 'zdolu', label: 'z dołu', prompt: 'ujęcie z dołu, bohater wygląda monumentalnie' },
      { value: 'centralnie', label: 'centralnie', prompt: 'kompozycja centralna, symetryczna' },
    ],
  },
  {
    key: 'mood',
    label: 'Nastrój',
    help: 'Z czym ma się kojarzyć.',
    options: [
      { value: 'minimalistyczny', label: 'minimalistyczny', prompt: 'minimalistyczny, dużo pustej przestrzeni' },
      { value: 'cieply', label: 'ciepły', prompt: 'ciepły, przyjazny nastrój' },
      { value: 'luksusowy', label: 'luksusowy', prompt: 'luksusowy, drogi wygląd' },
      { value: 'surowy', label: 'surowy', prompt: 'surowy, industrialny' },
      { value: 'energetyczny', label: 'energetyczny', prompt: 'energetyczny, dynamiczny' },
      { value: 'techniczny', label: 'techniczny', prompt: 'techniczny, chłodny, precyzyjny' },
    ],
  },
]

/** Osobna grupa: rzeczy, których model ma NIE robić. */
export const AVOID_OPTIONS = [
  { value: 'tekst', label: 'tekst na obrazie', prompt: 'napisy i litery' },
  { value: 'ludzie', label: 'ludzie', prompt: 'ludzie i twarze' },
  { value: 'zagracone', label: 'zagracone tło', prompt: 'zagracone tło' },
  { value: 'logo', label: 'cudze logo', prompt: 'znaki firmowe i logotypy' },
  { value: 'watermark', label: 'znak wodny', prompt: 'znaki wodne' },
  { value: 'kicz', label: 'kicz i stockowość', prompt: 'sztuczny, stockowy wygląd' },
]

export const STRENGTHS = [
  { value: 'lekki', label: 'lekko', lead: 'Nawiąż do stylu:' },
  { value: 'wyrazny', label: 'wyraźnie', lead: 'Zachowaj ten styl:' },
  { value: 'mocny', label: 'mocno', lead: 'Trzymaj się ściśle tego stylu:' },
]

export function chipPrompt(groupKey, value) {
  const group = CHIP_GROUPS.find((g) => g.key === groupKey)
  return group?.options.find((o) => o.value === value)?.prompt || null
}

export function avoidPrompt(value) {
  return AVOID_OPTIONS.find((o) => o.value === value)?.prompt || null
}

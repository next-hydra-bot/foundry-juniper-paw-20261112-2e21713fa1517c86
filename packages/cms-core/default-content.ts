import type { ContentModel, ContentProfile, RichText } from "./model";

const body = (text: string): RichText => [
  { children: [{ text }], type: "paragraph" },
];
const english = {
  intro:
    "Explore equipment, practical guides and support for your next project.",
  readGuide: "Read our guide",
  tagline: "Built for your business",
  hero: "Equipment and expertise for every job",
  home: "Home",
  maintenance:
    "Inspect equipment before every shift, track operating conditions, and follow up on maintenance findings.",
  summary: "Turn inspections and service intervals into a repeatable routine.",
  checklist: "A practical preventive maintenance checklist",
  guides: "Equipment guides",
};

const frenchCanadian = {
  intro:
    "Découvrez de l’équipement, des guides pratiques et du soutien pour votre prochain projet.",
  readGuide: "Lire notre guide",
  tagline: "Pensé pour votre entreprise",
  hero: "De l’équipement et de l’expertise pour tous vos travaux",
  home: "Accueil",
  maintenance:
    "Inspectez l’équipement avant chaque quart de travail, notez les conditions d’utilisation et donnez suite aux problèmes relevés.",
  summary:
    "Intégrez les inspections et les intervalles d’entretien à une routine facile à suivre.",
  checklist: "Une liste de vérification pratique pour l’entretien préventif",
  guides: "Guides sur l’équipement",
};

const copyFor = (locale: string) =>
  locale === "fr-CA" ? frenchCanadian : english;

/** Portable version of the existing editorial and commerce recipe content. */
export function defaultContent(model: ContentModel): ContentProfile {
  return {
    announcements: [],
    assets: [],
    entries: model.locales.flatMap((locale) => {
      const copy = copyFor(locale);
      return [
        {
          blocks: [
            {
              body: body(copy.intro),
              key: "welcome",
              links: [{ entryKey: "maintenance-guide", label: copy.readGuide }],
              tagline: copy.tagline,
              title: copy.hero,
              type: "hero" as const,
            },
          ],
          key: "home",
          locale,
          path: "/",
          published: true,
          title: copy.home,
          type: "page" as const,
        },
        {
          body: body(copy.maintenance),
          key: "maintenance-guide",
          locale,
          path: "/resources/preventive-maintenance-checklist",
          published: true,
          summary: copy.summary,
          title: copy.checklist,
          type: "article" as const,
        },
      ];
    }),
    model,
    navigation: model.locales.map((locale) => {
      const copy = copyFor(locale);
      const items = [
        { link: { entryKey: "home", label: copy.home } },
        { link: { entryKey: "maintenance-guide", label: copy.guides } },
      ];
      return {
        brandName: "TitanMach",
        footerDescription: copy.intro,
        footerItems: items,
        items,
        key: "main" as const,
        locale,
      };
    }),
  };
}

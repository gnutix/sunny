// Public webcams near each place: `image` always serves the latest picture and may be
// hotlinked (checked 2026-10-25), `page` is the operator's or aggregator's page.
// Roundshot images are 360° panoramas; /medium is 450 px high.
const guidle = (id) => `https://d37dhr5745n0y2.cloudfront.net/webcam_latest/${id}_original_latest.jpg`;

export const WEBCAMS = {
  'chasseral': { label: 'Hôtel Chasseral', page: 'https://hotel-chasseral.roundshot.com/', image: 'https://hotel-chasseral.roundshot.com/cams/2084/medium', panorama: true },
  'mont-soleil': { label: 'Mont-Soleil', page: 'https://montsoleil.roundshot.com/', image: 'https://montsoleil.roundshot.com/cams/696/medium', panorama: true },
  'vue-des-alpes': { label: 'Tête de Ran, next to the pass', page: 'https://tete-de-ran.roundshot.com/', image: 'https://backend.roundshot.com/cams/2da3e4959a04ed3d9ce03616ff321927/medium', panorama: true },
  'les-rasses': { label: 'Les Rasses', page: 'https://www.guidle.com/de/webcams/bullet/webcams/bullet-les-rasses_ACw5NJk', image: guidle(407010666) },
  'mollendruz': { label: 'Col du Mollendruz (Windy)', page: 'https://windy.com/webcams/1452817252' },
  'dent-de-vaulion': { label: 'Le Pont, Vallée de Joux', page: 'https://www.guidle.com/de/webcams/labbaye/vallee-de-joux_AwwAA2p', image: guidle(681875297) },
  'marchairuz': { label: 'Col du Marchairuz', page: 'https://www.guidle.com/de/webcams/le-brassus/le-cenit-col-du-marchairuz_AfjnGDK', image: guidle(558614176) },
  'givrine': { label: 'La Givrine', page: 'https://www.guidle.com/de/webcams/st-cergue/la-givrine_ArmC2HA', image: guidle(912115524) },
  'faucille': { label: 'La Faucille (bergfex)', page: 'https://www.bergfex.com/sommer/col-de-la-faucille/webcams/' },
  'saleve': { label: 'Téléphérique du Salève', page: 'https://www.telepherique-du-saleve.com/webcam/' },
  'pelerin': { label: 'Mont-Pèlerin', page: 'https://www.guidle.com/de/webcams/vevey/mont-pelerin_A4bc31L', image: guidle(558613413) },
  'pleiades': { label: 'Gare des Pléiades', page: 'https://www.guidle.com/de/webcams/blonay/gare-pleiades_ACi198G', image: guidle(816189773) },
  'paccots': { label: 'Les Paccots, Les Joncs', page: 'https://lespaccots.roundshot.com/', image: 'https://lespaccots.roundshot.com/cams/572/medium', panorama: true },
  'jaman': { label: 'Rochers de Naye, above the pass', page: 'https://www.guidle.com/de/webcams/veytaux/rochers-de-naye_A4cvyyY', image: guidle(681875238) },
  'moleson': { label: 'Moléson, Plan-Francey', page: 'https://www.moleson.ch/en/webcams/', image: 'https://www.moleson.ch/import/moleson_00002.jpg' },
  'leysin': { label: 'Leysin', page: 'https://leysin.roundshot.com/', image: 'https://leysin.roundshot.com/cams/966/medium', panorama: true },
  'mosses': { label: 'Col des Mosses', page: 'https://www.guidle.com/de/webcams/les-mosses/col-des-mosses_Anu6j92', image: guidle(768922905) },
  'villars': { label: 'Villars, Chaux Ronde', page: 'https://villars.roundshot.com/', image: 'https://villars.roundshot.com/cams/72/medium', panorama: true },
  'pillon': { label: 'Col du Pillon', page: 'https://www.guidle.com/de/webcams/les-diablerets/col-du-pillon_AaeRijV', image: guidle(558613819) },
  'schwarzsee': { label: 'Schwarzsee', page: 'https://www.guidle.com/en/webcams/schwarzsee-tourismus-schwarzsee_AAFCu6Y', image: guidle(681875335) },
  'jaunpass': { label: 'Jaunpass', page: 'https://www.guidle.com/de/webcams/jaunpass-boltigen_Ax3jhaT', image: guidle(798346648) },
  'sion': { label: 'Sion', page: 'https://www.guidle.com/de/webcams/sion/sion_AigUJNc', image: guidle(558613423) },
  'ovronnaz': { label: 'Ovronnaz, Bougnonne', page: 'https://ovronnaz.roundshot.com/', image: 'https://ovronnaz.roundshot.com/cams/165/medium', panorama: true },
  'anzere': { label: 'Anzère, village square', page: 'https://anzere.roundshot.com/', image: 'https://anzere.roundshot.com/cams/2/medium', panorama: true },
  'crans-montana': { label: 'Montana', page: 'https://www.guidle.com/de/webcams/crans-montana/luzerner-hoehenklinik-montana_AqyaQXc', image: guidle(681875246) },
  'champex': { label: 'Champex, La Breya', page: 'https://www.guidle.com/de/webcams/champex-lac/champex-la-breya_ANq39Th', image: guidle(781080315) },
};

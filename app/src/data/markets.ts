import laguna from "../assets/laguna.jpg";
import palmBeach from "../assets/palm-beach.jpg";
import sanFrancisco from "../assets/san-francisco.jpg";
import losAngeles from "../assets/los-angeles.jpg";
import laJolla from "../assets/la-jolla.jpg";
import miami from "../assets/miami.jpg";
import naples from "../assets/naples.jpg";
import fortLauderdale from "../assets/fort-lauderdale.jpg";
import hamptons from "../assets/hamptons.jpg";
import manhattan from "../assets/manhattan.jpg";
import brooklyn from "../assets/brooklyn.jpg";
import hudsonValley from "../assets/hudson-valley.jpg";
import type { Market } from "../domain/market";

/**
 * Matter of Place covers three markets: California, Florida and New York.
 * Regions carry their own page, collection and hero photograph.
 */
export const markets: Market[] = [
  {
    slug: "california",
    name: "California",
    country: "United States",
    currency: "USD",
    image: laguna,
    comingSoon: false,
    intro:
      "California is terrain before it is anything else. Ridges, canyons and bluffs decide where a house can sit, and the light, fog-filtered in the north, hard and golden in the south, decides how it should open.",
    places: [
      "Los Angeles",
      "Malibu",
      "Beverly Hills",
      "Westside",
      "Orange County",
      "San Francisco Bay Area",
      "Wine Country",
      "Select architectural destinations",
    ],
    notes: [
      {
        label: "Terrain",
        text: "Hillside lots, fire zones and coastal bluffs shape every plan. The best houses step with the land rather than flatten it.",
      },
      {
        label: "Lineage",
        text: "Bay Region shingle and redwood, Case Study glass and steel, Spanish Colonial courtyards, Sea Ranch restraint.",
      },
      {
        label: "Light",
        text: "Marine layer on the coast, clear heat inland. Overhangs, clerestories and deep eaves do the real work.",
      },
      {
        label: "What we look for",
        text: "Original architects on record, views held not borrowed, indoor-outdoor rooms that are used.",
      },
    ],
    guide: {
      neighborhoods: [
        {
          name: "Pacific Heights",
          region: "bay-area",
          text: "Edwardian and Classical Revival houses along the ridge, bay views between them.",
        },
        {
          name: "Mill Valley",
          region: "bay-area",
          text: "Redwood canyons under Mount Tamalpais; shingle houses and mid-century hillside glass.",
        },
        {
          name: "Los Altos Hills",
          region: "bay-area",
          text: "Oak-studded acreage above the Peninsula, with room for architecture to spread out.",
        },
        {
          name: "Hollywood Hills",
          region: "los-angeles",
          text: "Cantilevered modernism on steep lots; the city laid out below.",
        },
        {
          name: "Pasadena",
          region: "los-angeles",
          text: "Greene & Greene Craftsman, Arroyo Seco gardens, deep tree cover.",
        },
        {
          name: "Laguna Beach",
          region: "orange-county",
          text: "Artists' cottages and headland houses above coves and tide pools.",
        },
        {
          name: "La Jolla",
          region: "la-jolla",
          text: "Sandstone bluffs, a walkable village and houses stepped toward the sea.",
        },
      ],
      needs: [
        {
          label: "Buyers",
          text: "Architectural provenance, view protection, fire and slope reports read before the first visit.",
        },
        {
          label: "Sellers",
          text: "A story that explains the house: the architect, the site, why it was built this way.",
        },
        {
          label: "Relocating",
          text: "Guidance on microclimates, schools and commutes that differ sharply within a few miles.",
        },
      ],
      service: [
        {
          label: "Fire and coastal zones",
          text: "We note wildfire severity zones and Coastal Commission limits on every relevant home.",
        },
        {
          label: "Architect records",
          text: "Original drawings and architect attribution checked where they exist.",
        },
        {
          label: "Photography",
          text: "Shot in the light the house was designed for, often fog-soft morning or late gold.",
        },
      ],
    },
    regions: [
      {
        slug: "bay-area",
        name: "Bay Area",
        image: sanFrancisco,
        intro:
          "Redwood shingle, Victorian rows and mid-century hillside houses. Fog shapes the day; microclimates change street to street.",
        places: ["San Francisco", "Marin", "Peninsula", "Silicon Valley", "East Bay"],
      },
      {
        slug: "los-angeles",
        name: "Los Angeles",
        image: losAngeles,
        intro:
          "Neutra, Schindler and Lautner still set the standard. Canyon houses, courtyard Spanish and modern glass above the basin.",
        places: ["Westside", "Beverly Hills", "Malibu", "Hollywood Hills"],
      },
      {
        slug: "orange-county",
        name: "Orange County",
        image: laguna,
        intro:
          "Headlands and coves where a house is judged by what it frames of the Pacific, and how gently it sits on the bluff.",
        places: ["Laguna Beach", "Newport Beach", "Corona del Mar"],
      },
      {
        slug: "la-jolla",
        name: "La Jolla",
        image: laJolla,
        intro:
          "Sandstone bluffs, marine light and Irving Gill's white simplicity, still echoed along the coast.",
        places: ["La Jolla", "Del Mar", "Rancho Santa Fe"],
      },
    ],
  },
  {
    slug: "florida",
    name: "Florida",
    country: "United States",
    currency: "USD",
    image: palmBeach,
    comingSoon: false,
    intro:
      "Florida is water, shade and air. Houses here are built around the breeze and the storm season in equal measure: loggias, courtyards and deep roofs carrying as much weight as the rooms.",
    places: [
      "Miami",
      "Miami Beach",
      "Palm Beach",
      "Fort Lauderdale",
      "Naples",
      "Select significant properties",
    ],
    notes: [
      {
        label: "Water",
        text: "Bay, canal, Gulf or ocean: frontage, depth and elevation matter more than square footage.",
      },
      {
        label: "Lineage",
        text: "Addison Mizner's Mediterranean Revival, Miami Modern, Sarasota School, and a new generation of concrete pavilions.",
      },
      {
        label: "Climate",
        text: "Hurricane codes, flood elevations and cross-ventilation shape every serious house built since 1992.",
      },
      {
        label: "What we look for",
        text: "Shade used well, gardens given time to mature, and architecture that stays cool without apology.",
      },
    ],
    guide: {
      neighborhoods: [
        {
          name: "Miami Beach",
          region: "miami",
          text: "Bayfront islands, MiMo landmarks and new concrete pavilions on the water.",
        },
        {
          name: "Coconut Grove",
          region: "miami",
          text: "Miami's oldest canopy; bungalows and modern houses hidden under banyans.",
        },
        {
          name: "Coral Gables",
          region: "miami",
          text: "Planned Mediterranean streets, strict design review, coral rock walls.",
        },
        {
          name: "Palm Beach",
          region: "palm-beach",
          text: "Mizner and Wyeth estates behind hedges; an island that protects its look.",
        },
        {
          name: "Jupiter Island",
          region: "palm-beach",
          text: "Quiet, low-lying, and among the most private stretches of the coast.",
        },
        {
          name: "Port Royal",
          region: "naples",
          text: "Deep-water canals to the Gulf, with generous lots and sunset exposure.",
        },
        {
          name: "Las Olas Isles",
          region: "fort-lauderdale",
          text: "Finger islands with ocean access from the back lawn.",
        },
      ],
      needs: [
        {
          label: "Buyers",
          text: "Flood zone, elevation, seawall condition and insurance reviewed before the romance.",
        },
        {
          label: "Sellers",
          text: "Presentation that shows how the house lives in heat and light, not only its size.",
        },
        {
          label: "Seasonal owners",
          text: "Houses that close up well for summer and open easily in winter.",
        },
      ],
      service: [
        {
          label: "Storm-ready details",
          text: "Impact glass, roof age and post-1992 code compliance noted on every home.",
        },
        {
          label: "Water access",
          text: "Dock depth, bridge clearance and time to open water recorded where relevant.",
        },
        {
          label: "Historic review",
          text: "Palm Beach and Coral Gables landmark status flagged up front.",
        },
      ],
    },
    regions: [
      {
        slug: "miami",
        name: "Miami",
        image: miami,
        intro:
          "MiMo on the Beach, Coral Gables' Mediterranean streets, the old tree canopy of Coconut Grove.",
        places: ["Miami", "Miami Beach", "Coconut Grove", "Coral Gables"],
      },
      {
        slug: "palm-beach",
        name: "Palm Beach",
        image: palmBeach,
        intro:
          "Mizner and Wyeth, clipped ficus hedges and a town that guards its architecture closely.",
        places: ["Palm Beach", "Manalapan", "Jupiter Island"],
      },
      {
        slug: "naples",
        name: "Naples",
        image: naples,
        intro:
          "Gulf sunsets, low horizons and deep-water canals in Port Royal and Aqualane Shores.",
        places: ["Old Naples", "Port Royal", "Aqualane Shores"],
      },
      {
        slug: "fort-lauderdale",
        name: "Fort Lauderdale",
        image: fortLauderdale,
        intro:
          "The Venice of America: canal-front pavilions where the living room and the dock are one.",
        places: ["Fort Lauderdale", "Las Olas Isles", "Boca Raton"],
      },
    ],
  },
  {
    slug: "new-york",
    name: "New York",
    country: "United States",
    currency: "USD",
    image: manhattan,
    comingSoon: false,
    intro:
      "New York is history held in brick, brownstone and cast iron. Beyond the city: shingle, fieldstone and open field. Landmarks law, the block and the season shape everything.",
    places: ["Manhattan", "Brooklyn", "The Hamptons", "Hudson Valley", "Select Upstate properties"],
    notes: [
      {
        label: "The block",
        text: "Width, light and the street matter as much as the house. A 25-foot townhouse on the right block is its own category.",
      },
      {
        label: "Lineage",
        text: "Federal and Greek Revival rows, Italianate brownstone, SoHo cast iron, Shingle Style on the East End, Dutch stone upstate.",
      },
      {
        label: "Landmarks",
        text: "Historic districts protect the fabric and set the terms for any change. We note designation on every house.",
      },
      {
        label: "What we look for",
        text: "Original detail intact, careful restoration over renovation, and light found in a dense city.",
      },
    ],
    guide: {
      neighborhoods: [
        {
          name: "West Village",
          region: "manhattan",
          text: "Crooked streets, Federal and Greek Revival townhouses, the city at its most intimate.",
        },
        {
          name: "Tribeca",
          region: "manhattan",
          text: "Cast-iron and warehouse lofts on cobblestone, generous volumes and light.",
        },
        {
          name: "Upper East Side",
          region: "manhattan",
          text: "Limestone townhouses and pre-war co-ops between Central Park and Madison.",
        },
        {
          name: "Brooklyn Heights",
          region: "brooklyn",
          text: "New York's first historic district; brownstones one block from the harbour.",
        },
        {
          name: "Park Slope",
          region: "brooklyn",
          text: "Romanesque and Queen Anne rows beside Prospect Park.",
        },
        {
          name: "Sagaponack",
          region: "the-hamptons",
          text: "Farmland meeting the ocean; shingle houses behind tall privet.",
        },
        {
          name: "Rhinebeck",
          region: "hudson-valley",
          text: "River estates, stone farmhouses and a village that keeps its scale.",
        },
      ],
      needs: [
        {
          label: "Buyers",
          text: "Co-op boards, landmark rules and townhouse condition explained clearly and early.",
        },
        {
          label: "Sellers",
          text: "Original detail given its due: mouldings, stoops, cast iron, before square footage.",
        },
        {
          label: "Country houses",
          text: "Weekend-ready homes within reach of the city, with land and privacy.",
        },
      ],
      service: [
        {
          label: "Landmark status",
          text: "Historic district and individual designation noted on every listing.",
        },
        {
          label: "Co-op and condo",
          text: "Building type, board expectations and financing limits summarised simply.",
        },
        {
          label: "Seasons",
          text: "East End and Hudson Valley homes photographed in the season that suits them.",
        },
      ],
    },
    regions: [
      {
        slug: "manhattan",
        name: "Manhattan",
        image: manhattan,
        intro:
          "Village townhouses off the grid, Tribeca lofts behind cast iron, and limestone on the Upper East Side.",
        places: ["West Village", "Tribeca", "Upper East Side"],
      },
      {
        slug: "brooklyn",
        name: "Brooklyn",
        image: brooklyn,
        intro:
          "Brownstone and limestone rows with stoops, gardens and parlour floors largely intact.",
        places: ["Brooklyn Heights", "Cobble Hill", "Park Slope"],
      },
      {
        slug: "the-hamptons",
        name: "The Hamptons",
        image: hamptons,
        intro:
          "Silvered shingle, privet and farmland meeting the Atlantic dunes on the South Fork.",
        places: ["Sagaponack", "East Hampton", "Southampton"],
      },
      {
        slug: "hudson-valley",
        name: "Hudson Valley",
        image: hudsonValley,
        intro: "River estates, Dutch stone farmhouses and new barns set against the Catskills.",
        places: ["Rhinebeck", "Hudson", "Millbrook", "Select Upstate"],
      },
    ],
  },
];

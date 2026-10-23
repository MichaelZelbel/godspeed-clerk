// Made-up papers and recorded AI answers that several test files share. Nothing here is real.
export const HOTEL_TREE = { Paperwork: { Travel: {}, Letters: {}, "Fairway Rail": {}, "Wayfarer Trips Ltd": {} }, "Holiday photos": { "beach.jpg": "Not a document." } };
export const booking = { slug: "hotel-booking", owner: "alex", content: "Wayfarer Trips. Booking confirmation WT-55102 for Hotel Lindenhof, Hillport, 3 to 5 November 2026. Guest Alex Morgan, 12 Elm Row, 40210 Fairford. Total 212.00 EUR, paid by card." };
export const bookingSorted = { match: ["WT-55102"], answer: { title: "Hotel booking Hotel Lindenhof Hillport", correspondent: "Wayfarer", document_type: null, tags: [], created: "2026-10-21", folder: null, confident: false, unsure: ["correspondent", "document_type"] } };
export const bookingPlaces = { match: ["Suggest places", "WT-55102"], answer: { places: [{ new_folder: "Hotel Lindenhof" }, { folder: "Travel" }, { new_folder: "Wayfarer Trips" }, { folder: "Holiday photos" }, { folder: "Letters" }] } };


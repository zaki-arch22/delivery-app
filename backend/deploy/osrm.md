# Road distances: our own OSRM server (free)

OSRM is free, open-source routing software. It reads OpenStreetMap road data and answers "how far by road from A to B".
We run it ourselves, on the same server as the API, listening ONLY on 127.0.0.1 (never reachable from the internet).
No account, no key, no payment card, no usage limit. The public OSRM demo server must NOT be used (its policy allows only non-commercial use).

Status: the connection is built and tested against a made-up test grid. These steps have NOT yet been run with real Algeria data
(the build machine's network blocks the download site). Test them on the real server before launch.

## Build the road data (repeat monthly to get new roads)
    sudo apt-get install -y osmium-tool libtbb12 libtbbmalloc2
    cd /srv/osrm
    curl -LO https://download.geofabrik.de/africa/algeria-latest.osm.pbf        # OpenStreetMap data for Algeria (ODbL licence)
    # Keep only the Algiers area (west, south, east, north). Widen this box when new wilayas open.
    osmium extract -b 2.60,36.45,3.55,36.85 algeria-latest.osm.pbf -o algiers.osm.pbf --overwrite
    BIN=/srv/delivery/backend/node_modules/@project-osrm/osrm/lib/binding_napi_v8
    $BIN/osrm-extract -p /srv/delivery/backend/node_modules/@project-osrm/osrm/profiles/car.lua algiers.osm.pbf
    $BIN/osrm-contract algiers.osrm
(The OSRM programs come with `npm ci` in backend/; they are the same version the tests use.)

## Run it
    $BIN/osrm-routed --ip 127.0.0.1 -p 5000 /srv/osrm/algiers.osrm
Run it as a service like deploy/delivery.service (same sandboxing, its own user), then set in /etc/delivery/env:
    ROUTING_URL=http://127.0.0.1:5000

## Safety
- If OSRM is stopped, slow (over ROUTING_TIMEOUT_MS, default 1.5 s) or finds no road, quotes still work with the straight-line
  estimate and are marked `distance_estimated: true`. Tested (OSRM up, down, and not answering).
- `npm run launch-check` warns when ROUTING_URL is not set.
- Map credit required by the licence: "© OpenStreetMap contributors" (shown on the app's map).

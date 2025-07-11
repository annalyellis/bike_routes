import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

console.log('Mapbox GL JS Loaded:', mapboxgl);

mapboxgl.accessToken = 'pk.eyJ1IjoiYW5lbGxpcyIsImEiOiJjbWFua250dGIwdG45MmxwcjFycm9xeXV1In0.PPCrdoJOpmwACTkk_JJtgw';

const tooltip = d3.select('body')
  .append('div')
  .attr('class', 'tooltip')
  .style('position', 'absolute')
  .style('background', 'white')
  .style('border', '1px solid #ddd')
  .style('border-radius', '4px')
  .style('padding', '10px')
  .style('pointer-events', 'none')
  .style('opacity', 0)
  .style('z-index', 1000);

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

let stations = [];
let trips = [];
let radiusScale;
let circles;

// Create the quantize scale for station flow
let stationFlow = d3.scaleQuantize()
  .domain([0, 1])
  .range([0, 0.5, 1]);

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function filterTripsbyTime(trips, timeFilter) {
  return timeFilter === -1
    ? trips
    : trips.filter((trip) => {
        const started = minutesSinceMidnight(trip.started_at);
        const ended = minutesSinceMidnight(trip.ended_at);
        return Math.abs(started - timeFilter) <= 60 || Math.abs(ended - timeFilter) <= 60;
      });
}

function computeStationTraffic(stations, trips) {
  const departures = d3.rollup(trips, v => v.length, d => d.start_station_id);
  const arrivals = d3.rollup(trips, v => v.length, d => d.end_station_id);

  return stations.map((station) => {
    const id = station.short_name;
    station.departures = departures.get(id) ?? 0;
    station.arrivals = arrivals.get(id) ?? 0;
    station.totalTraffic = station.departures + station.arrivals;
    return station;
  });
}

const timeSlider = document.getElementById('time-filter');
const selectedTime = document.getElementById('selected-time');
const anyTimeLabel = document.getElementById('any-time');

function updateTimeDisplay() {
  const timeFilter = Number(timeSlider.value);

  if (timeFilter === -1) {
    selectedTime.textContent = '';
    anyTimeLabel.style.display = 'block';
  } else {
    selectedTime.textContent = formatTime(timeFilter);
    anyTimeLabel.style.display = 'none';
  }

  updateScatterPlot(timeFilter);
}

function updateScatterPlot(timeFilter) {
  const filteredTrips = filterTripsbyTime(trips, timeFilter);
  const filteredStations = computeStationTraffic(stations, filteredTrips);

  radiusScale.range(timeFilter === -1 ? [0, 25] : [3, 50]);

  circles
    .data(filteredStations, d => d.short_name)
    .join(
      enter => enter.append('circle')
        .attr('stroke', 'white')
        .attr('stroke-width', 1)
        .attr('opacity', 0.8)
        .style('pointer-events', 'all')
        .style('cursor', 'pointer')
        .on('mouseover', function(event, d) {
          tooltip.transition().duration(200).style('opacity', 0.9);
          tooltip.html(`${d.name}<br>${d.totalTraffic} trips<br>${d.departures} departures<br>${d.arrivals} arrivals`)
            .style('left', `${event.pageX + 10}px`)
            .style('top', `${event.pageY - 28}px`);
        })
        .on('mouseout', () => {
          tooltip.transition().duration(500).style('opacity', 0);
        }),
      update => update,
      exit => exit.remove()
    )
    .attr('r', d => radiusScale(d.totalTraffic))
    .style('--departure-ratio', d => {
      // Ensure we don't divide by zero
      if (d.totalTraffic === 0) return 0;
      
      // Calculate the ratio and use the stationFlow scale
      return stationFlow(d.departures / d.totalTraffic);
    })
    .attr('cx', d => getCoords(d).cx)
    .attr('cy', d => getCoords(d).cy);
}

let svg;
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

function updatePositions() {
  if (circles) {
    circles
      .attr('cx', d => getCoords(d).cx)
      .attr('cy', d => getCoords(d).cy);
  }
}

map.on('load', async () => {
  const container = map.getCanvasContainer();
  d3.select(container).select('svg').remove();

  svg = d3.select(container)
    .append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .style('position', 'absolute')
    .style('z-index', 2)
    .style('pointer-events', 'auto');

  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': 'hotpink',
      'line-width': 5,
      'line-opacity': 0.6,
    },
  });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: {
      'line-color': 'hotpink',
      'line-width': 5,
      'line-opacity': 0.6,
    },
  });

  const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
  const stationData = await d3.json(jsonurl);
  stations = stationData.data.stations;

  trips = await d3.csv('https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv', (trip) => {
    trip.started_at = new Date(trip.started_at);
    trip.ended_at = new Date(trip.ended_at);
    return trip;
  });

  stations = computeStationTraffic(stations, trips);

  radiusScale = d3.scaleSqrt()
    .domain([0, d3.max(stations, d => d.totalTraffic)])
    .range([0, 25]);
  
  circles = svg
    .selectAll('circle')
    .data(stations, d => d.short_name)
    .enter()
    .append('circle')
    .attr('r', d => radiusScale(d.totalTraffic))
    .attr('stroke', 'white')
    .attr('stroke-width', 1)
    .attr('opacity', 0.8)
    .style('pointer-events', 'all')
    .style('cursor', 'pointer')
    .style('--departure-ratio', d => {
      if (d.totalTraffic === 0) return 0;
      
      return stationFlow(d.departures / d.totalTraffic);
    })
    .on('mouseover', function(event, d) {
      tooltip.transition().duration(200).style('opacity', 0.9);
      tooltip.html(`${d.name}<br>${d.totalTraffic} trips<br>${d.departures} departures<br>${d.arrivals} arrivals`)
        .style('left', `${event.pageX + 10}px`)
        .style('top', `${event.pageY - 28}px`);
    })
    .on('mouseout', () => {
      tooltip.transition().duration(500).style('opacity', 0);
    });

  updatePositions();

  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  if (timeSlider) {
    timeSlider.addEventListener('input', updateTimeDisplay);
    updateTimeDisplay();
  }
});

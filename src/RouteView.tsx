import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

import type { PointRecord } from './routeMath';

const SIZE = 300;
const PAD = 12;
const METRES_PER_DEG_LAT = 111_320;

/**
 * Route as SVG polylines on a local equirectangular projection (accurate enough for a walk).
 * Recorded segments are solid; gaps between them are dashed and not counted as distance.
 */
export function RouteView({ segments }: { segments: PointRecord[][] }) {
  const points = segments.flat();
  if (points.length < 2) {
    return <Text style={styles.empty}>Zu wenige Punkte für eine Route.</Text>;
  }

  const lat0 = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const lonScale = Math.cos((lat0 * Math.PI) / 180);
  const toXY = (p: PointRecord) => ({
    x: p.lon * lonScale * METRES_PER_DEG_LAT,
    y: -p.lat * METRES_PER_DEG_LAT,
  });
  const xy = points.map(toXY);
  const minX = Math.min(...xy.map((q) => q.x));
  const minY = Math.min(...xy.map((q) => q.y));
  const spanM = Math.max(Math.max(...xy.map((q) => q.x)) - minX, Math.max(...xy.map((q) => q.y)) - minY, 1);
  const k = (SIZE - 2 * PAD) / spanM;
  const screen = (p: PointRecord) => {
    const q = toXY(p);
    return { x: PAD + (q.x - minX) * k, y: PAD + (q.y - minY) * k };
  };

  const lines = segments.map((segment) => segment.map(screen));
  const first = lines[0][0];
  const lastLine = lines[lines.length - 1];
  const last = lastLine[lastLine.length - 1];

  return (
    <View>
      <Svg width={SIZE} height={SIZE} style={styles.svg}>
        {lines.slice(1).map((line, i) => {
          const a = lines[i][lines[i].length - 1];
          const b = line[0];
          return (
            <Line key={`gap-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#c0392b" strokeWidth={2} strokeDasharray="4 4" />
          );
        })}
        {lines.map((line, i) => (
          <Polyline
            key={`seg-${i}`}
            points={line.map((s) => `${s.x},${s.y}`).join(' ')}
            fill="none"
            stroke="#1f6feb"
            strokeWidth={3}
            strokeLinejoin="round"
          />
        ))}
        <Circle cx={first.x} cy={first.y} r={5} fill="#2da44e" />
        <Circle cx={last.x} cy={last.y} r={5} fill="#cf222e" />
      </Svg>
      <Text style={styles.caption}>
        Grün = Start, Rot = Ende, gestrichelt = Lücke. Kantenlänge ≈ {Math.round(spanM)} m.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  svg: { backgroundColor: '#f6f8fa', borderRadius: 8, alignSelf: 'center' },
  caption: { fontSize: 12, color: '#57606a', marginTop: 6, textAlign: 'center' },
  empty: { color: '#57606a', fontStyle: 'italic' },
});

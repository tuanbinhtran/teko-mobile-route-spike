import * as Brightness from 'expo-brightness';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState, Modal, Pressable, StyleSheet, Text } from 'react-native';

const KEEP_AWAKE_TAG = 'pawtrack-pocket';

/**
 * Black, brightness-0, keep-awake overlay for foreground recording in a pocket.
 * Taps are swallowed; only a long press leaves. Brightness is restored on exit.
 * iOS reverts our brightness when the device locks, so it is re-applied on return.
 */
export function PocketMode({ onExit }: { onExit: () => void }) {
  useEffect(() => {
    let cancelled = false;
    let saved: number | null = null;
    void (async () => {
      const current = await Brightness.getBrightnessAsync();
      if (cancelled) return;
      saved = current;
      await Brightness.setBrightnessAsync(0);
      await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    })();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void Brightness.setBrightnessAsync(0);
    });
    return () => {
      cancelled = true;
      sub.remove();
      void deactivateKeepAwake(KEEP_AWAKE_TAG);
      if (saved !== null) void Brightness.setBrightnessAsync(saved);
    };
  }, []);

  return (
    <Modal visible animationType="none" presentationStyle="fullScreen" onRequestClose={onExit}>
      <StatusBar hidden />
      <Pressable style={styles.black} onLongPress={onExit} delayLongPress={1500}>
        <Text style={styles.hint}>Taschenmodus – lange drücken zum Beenden</Text>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  black: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 60 },
  hint: { color: '#1a1a1a', fontSize: 13 },
});

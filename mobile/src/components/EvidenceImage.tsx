import React, { useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/theme';
import { type AiMarks, boxToRect, containRect, marksCaption } from '../utils/evidence-marks';

interface EvidenceImageProps {
  url: string;
  /** Caixas desenhadas pela IA neste quadro (uma por unidade); null mostra só a imagem. */
  marks?: AiMarks | null;
}

const BOX_COLOR = '#22C55E';

/** Quadro de evidência em tela cheia com as unidades marcadas pela IA numeradas por cima. */
export const EvidenceImage: React.FC<EvidenceImageProps> = ({ url, marks }) => {
  const [container, setContainer] = useState({ width: 0, height: 0 });
  const [loaded, setLoaded] = useState<{ width: number; height: number } | null>(null);
  const [showMarks, setShowMarks] = useState(true);

  const imageSize = loaded ?? (marks?.width && marks?.height ? { width: marks.width, height: marks.height } : null);
  const area = imageSize ? containRect(container, imageSize) : null;
  const hasMarks = Boolean(marks && marks.boxes.length);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainer({ width, height });
  };

  return (
    <View style={styles.wrapper}>
      <View style={styles.stage} onLayout={onLayout} testID="evidence-stage">
        <Image
          source={{ uri: url }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          onLoad={(e) => setLoaded({ width: e.source.width, height: e.source.height })}
        />
        {showMarks && hasMarks && area && area.width > 0
          ? marks!.boxes.map((box, index) => {
              const r = boxToRect(box, area);
              return (
                <View
                  key={index}
                  pointerEvents="none"
                  testID="evidence-box"
                  style={[styles.box, { left: r.x, top: r.y, width: r.width, height: r.height }]}
                >
                  <Text style={styles.boxLabel}>{index + 1}</Text>
                </View>
              );
            })
          : null}
      </View>

      {hasMarks ? (
        <View style={styles.footer}>
          <Text style={styles.caption}>{marksCaption(marks!)}</Text>
          <TouchableOpacity
            onPress={() => setShowMarks((v) => !v)}
            style={styles.toggle}
            accessibilityRole="button"
            accessibilityLabel={showMarks ? 'Ocultar marcações' : 'Mostrar marcações'}
          >
            <Ionicons name={showMarks ? 'eye-off-outline' : 'eye-outline'} size={16} color="#FFF" />
            <Text style={styles.toggleText}>{showMarks ? 'Ocultar' : 'Mostrar'} marcações</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    width: '100%',
  },
  stage: {
    flex: 1,
    width: '100%',
  },
  box: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: BOX_COLOR,
    borderRadius: 3,
  },
  boxLabel: {
    position: 'absolute',
    top: -1,
    left: -1,
    minWidth: 16,
    paddingHorizontal: 3,
    backgroundColor: BOX_COLOR,
    color: '#052E16',
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'center',
  },
  footer: {
    paddingTop: 12,
    gap: 8,
    alignItems: 'center',
  },
  caption: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.surfaceBorderStrong,
  },
  toggleText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
  },
});

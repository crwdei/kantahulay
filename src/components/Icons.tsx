import React from 'react';
import { View, StyleProp, ViewStyle } from 'react-native';

interface IconProps {
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}

export const PlayIcon: React.FC<IconProps> = ({ size = 16, color = '#FFFFFF', style }) => {
  const h = size;
  const w = Math.round(size * 0.85);
  return (
    <View style={[{ width: w, height: h, justifyContent: 'center', alignItems: 'center' }, style]}>
      <View
        style={{
          width: 0,
          height: 0,
          borderStyle: 'solid',
          borderLeftWidth: w,
          borderTopWidth: h / 2,
          borderBottomWidth: h / 2,
          borderLeftColor: color,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
        }}
      />
    </View>
  );
};

export const PauseIcon: React.FC<IconProps> = ({ size = 16, color = '#FFFFFF', style }) => {
  const barW = Math.max(3, Math.round(size * 0.28));
  const gap = Math.max(3, Math.round(size * 0.25));
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
        },
        style,
      ]}
    >
      <View
        style={{
          width: barW,
          height: size,
          backgroundColor: color,
          borderRadius: 1.5,
          marginRight: gap,
        }}
      />
      <View
        style={{
          width: barW,
          height: size,
          backgroundColor: color,
          borderRadius: 1.5,
        }}
      />
    </View>
  );
};

export const StopIcon: React.FC<IconProps> = ({ size = 14, color = '#FFFFFF', style }) => {
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          backgroundColor: color,
          borderRadius: 2,
        },
        style,
      ]}
    />
  );
};

export const NextIcon: React.FC<IconProps> = ({ size = 16, color = '#FFFFFF', style }) => {
  const h = size;
  const triW = Math.round(size * 0.6);
  const barW = Math.max(2.5, Math.round(size * 0.2));
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <View
        style={{
          width: 0,
          height: 0,
          borderStyle: 'solid',
          borderLeftWidth: triW,
          borderTopWidth: h / 2,
          borderBottomWidth: h / 2,
          borderLeftColor: color,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
        }}
      />
      <View
        style={{
          width: barW,
          height: h,
          backgroundColor: color,
          borderRadius: 1,
          marginLeft: 2,
        }}
      />
    </View>
  );
};

export const PlusIcon: React.FC<IconProps> = ({ size = 16, color = '#FFFFFF', style }) => {
  const thick = Math.max(2.5, Math.round(size * 0.16));
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          justifyContent: 'center',
          alignItems: 'center',
        },
        style,
      ]}
    >
      <View
        style={{
          position: 'absolute',
          width: size,
          height: thick,
          backgroundColor: color,
          borderRadius: 1,
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: thick,
          height: size,
          backgroundColor: color,
          borderRadius: 1,
        }}
      />
    </View>
  );
};

export const MinusIcon: React.FC<IconProps> = ({ size = 16, color = '#FFFFFF', style }) => {
  const thick = Math.max(2.5, Math.round(size * 0.16));
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          justifyContent: 'center',
          alignItems: 'center',
        },
        style,
      ]}
    >
      <View
        style={{
          width: size,
          height: thick,
          backgroundColor: color,
          borderRadius: 1,
        }}
      />
    </View>
  );
};

export const SearchIcon: React.FC<IconProps> = ({ size = 18, color = '#888888', style }) => {
  const circleSize = Math.round(size * 0.65);
  const borderWidth = Math.max(2, Math.round(size * 0.12));
  const handleLen = Math.round(size * 0.45);
  return (
    <View style={[{ width: size, height: size, position: 'relative' }, style]}>
      <View
        style={{
          width: circleSize,
          height: circleSize,
          borderRadius: circleSize / 2,
          borderWidth,
          borderColor: color,
          position: 'absolute',
          top: 0,
          left: 0,
        }}
      />
      <View
        style={{
          width: borderWidth,
          height: handleLen,
          backgroundColor: color,
          position: 'absolute',
          bottom: 0,
          right: 2,
          transform: [{ rotate: '-45deg' }],
          borderRadius: 1,
        }}
      />
    </View>
  );
};

export const BookIcon: React.FC<IconProps> = ({ size = 16, color = '#FFFFFF', style }) => {
  const w = size;
  const h = Math.round(size * 0.85);
  return (
    <View
      style={[
        {
          width: w,
          height: h,
          borderWidth: 2,
          borderColor: color,
          borderRadius: 3,
          justifyContent: 'center',
          alignItems: 'center',
        },
        style,
      ]}
    >
      <View style={{ width: 1.5, height: h - 4, backgroundColor: color }} />
    </View>
  );
};

export const CloseIcon: React.FC<IconProps> = ({ size = 18, color = '#FFFFFF', style }) => {
  const thick = Math.max(2, Math.round(size * 0.14));
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          justifyContent: 'center',
          alignItems: 'center',
        },
        style,
      ]}
    >
      <View
        style={{
          position: 'absolute',
          width: size,
          height: thick,
          backgroundColor: color,
          borderRadius: 1,
          transform: [{ rotate: '45deg' }],
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: size,
          height: thick,
          backgroundColor: color,
          borderRadius: 1,
          transform: [{ rotate: '-45deg' }],
        }}
      />
    </View>
  );
};

export const MusicIcon: React.FC<IconProps> = ({ size = 18, color = '#FFD600', style }) => {
  const noteHead = Math.round(size * 0.32);
  const stemH = Math.round(size * 0.65);
  return (
    <View style={[{ width: size, height: size, position: 'relative' }, style]}>
      <View
        style={{
          width: noteHead,
          height: noteHead * 0.8,
          borderRadius: noteHead / 2,
          backgroundColor: color,
          position: 'absolute',
          bottom: 1,
          left: 0,
        }}
      />
      <View
        style={{
          width: 2,
          height: stemH,
          backgroundColor: color,
          position: 'absolute',
          bottom: noteHead * 0.4,
          left: noteHead - 2,
        }}
      />
      <View
        style={{
          width: noteHead,
          height: noteHead * 0.8,
          borderRadius: noteHead / 2,
          backgroundColor: color,
          position: 'absolute',
          bottom: 3,
          right: 0,
        }}
      />
      <View
        style={{
          width: 2,
          height: stemH,
          backgroundColor: color,
          position: 'absolute',
          bottom: noteHead * 0.4 + 2,
          right: 0,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: noteHead - 2,
          right: 0,
          height: 3,
          backgroundColor: color,
          transform: [{ rotate: '5deg' }],
        }}
      />
    </View>
  );
};

export const CheckIcon: React.FC<IconProps> = ({ size = 16, color = '#FFFFFF', style }) => {
  return (
    <View style={[{ width: size, height: size, position: 'relative' }, style]}>
      <View
        style={{
          width: 2,
          height: size * 0.4,
          backgroundColor: color,
          position: 'absolute',
          bottom: size * 0.25,
          left: size * 0.25,
          transform: [{ rotate: '-45deg' }],
        }}
      />
      <View
        style={{
          width: 2,
          height: size * 0.7,
          backgroundColor: color,
          position: 'absolute',
          bottom: size * 0.2,
          left: size * 0.55,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
};

export const MicIcon: React.FC<IconProps> = ({ size = 48, color = '#FFD600', style }) => {
  const micW = Math.round(size * 0.4);
  const micH = Math.round(size * 0.55);
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          alignItems: 'center',
          position: 'relative',
        },
        style,
      ]}
    >
      <View
        style={{
          width: micW,
          height: micH,
          backgroundColor: color,
          borderRadius: micW / 2,
          marginBottom: 2,
        }}
      />
      <View
        style={{
          width: micW + 8,
          height: micH * 0.55,
          borderBottomLeftRadius: (micW + 8) / 2,
          borderBottomRightRadius: (micW + 8) / 2,
          borderWidth: 2.5,
          borderTopWidth: 0,
          borderColor: color,
          position: 'absolute',
          top: micH * 0.45,
        }}
      />
      <View
        style={{
          width: 2.5,
          height: size * 0.18,
          backgroundColor: color,
          position: 'absolute',
          bottom: size * 0.1,
        }}
      />
      <View
        style={{
          width: micW + 4,
          height: 2.5,
          backgroundColor: color,
          position: 'absolute',
          bottom: size * 0.08,
          borderRadius: 1,
        }}
      />
    </View>
  );
};

export const SettingsIcon: React.FC<IconProps> = ({ size = 18, color = '#FFFFFF', style }) => {
  const toothW = Math.max(2.5, Math.round(size * 0.2));
  const toothH = Math.max(2, Math.round(size * 0.16));
  const ringSize = Math.round(size * 0.68);
  const ringBorder = Math.max(2, Math.round(size * 0.12));

  const renderToothPair = (angle: string) => (
    <View
      key={angle}
      style={{
        position: 'absolute',
        width: toothW,
        height: size,
        justifyContent: 'space-between',
        alignItems: 'center',
        transform: [{ rotate: angle }],
      }}
    >
      <View style={{ width: toothW, height: toothH, backgroundColor: color, borderRadius: 1 }} />
      <View style={{ width: toothW, height: toothH, backgroundColor: color, borderRadius: 1 }} />
    </View>
  );

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          justifyContent: 'center',
          alignItems: 'center',
        },
        style,
      ]}
    >
      {renderToothPair('0deg')}
      {renderToothPair('45deg')}
      {renderToothPair('90deg')}
      {renderToothPair('135deg')}
      <View
        style={{
          width: ringSize,
          height: ringSize,
          borderRadius: ringSize / 2,
          borderWidth: ringBorder,
          borderColor: color,
        }}
      />
    </View>
  );
};

export const ChevronLeftIcon: React.FC<IconProps> = ({ size = 16, color = '#FFFFFF', style }) => {
  const thick = Math.max(2, Math.round(size * 0.16));
  const arm = Math.round(size * 0.45);
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          justifyContent: 'center',
          alignItems: 'center',
        },
        style,
      ]}
    >
      <View
        style={{
          width: arm,
          height: arm,
          borderLeftWidth: thick,
          borderBottomWidth: thick,
          borderColor: color,
          transform: [{ rotate: '45deg' }],
          marginLeft: Math.round(size * 0.15),
        }}
      />
    </View>
  );
};

export const ChevronRightIcon: React.FC<IconProps> = ({ size = 16, color = '#FFFFFF', style }) => {
  const thick = Math.max(2, Math.round(size * 0.16));
  const arm = Math.round(size * 0.45);
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          justifyContent: 'center',
          alignItems: 'center',
        },
        style,
      ]}
    >
      <View
        style={{
          width: arm,
          height: arm,
          borderRightWidth: thick,
          borderTopWidth: thick,
          borderColor: color,
          transform: [{ rotate: '45deg' }],
          marginRight: Math.round(size * 0.15),
        }}
      />
    </View>
  );
};

export const ChevronUpIcon: React.FC<IconProps> = ({ size = 16, color = '#FFFFFF', style }) => {
  const thick = Math.max(2, Math.round(size * 0.16));
  const arm = Math.round(size * 0.45);
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          justifyContent: 'center',
          alignItems: 'center',
        },
        style,
      ]}
    >
      <View
        style={{
          width: arm,
          height: arm,
          borderLeftWidth: thick,
          borderTopWidth: thick,
          borderColor: color,
          transform: [{ rotate: '45deg' }],
          marginTop: Math.round(size * 0.15),
        }}
      />
    </View>
  );
};

export const ChevronDownIcon: React.FC<IconProps> = ({ size = 16, color = '#FFFFFF', style }) => {
  const thick = Math.max(2, Math.round(size * 0.16));
  const arm = Math.round(size * 0.45);
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          justifyContent: 'center',
          alignItems: 'center',
        },
        style,
      ]}
    >
      <View
        style={{
          width: arm,
          height: arm,
          borderRightWidth: thick,
          borderBottomWidth: thick,
          borderColor: color,
          transform: [{ rotate: '45deg' }],
          marginBottom: Math.round(size * 0.15),
        }}
      />
    </View>
  );
};

export const RotateDeviceIcon: React.FC<IconProps> = ({ size = 24, color = '#FFD600', style }) => {
  // Landscape phone chassis (horizontal rounded rectangle)
  const phoneW = Math.round(size * 0.68);
  const phoneH = Math.round(size * 0.44);
  const borderThick = Math.max(1.5, Math.round(size * 0.075));
  const innerW = phoneW - borderThick * 2 - 2;
  const innerH = phoneH - borderThick * 2 - 2;

  // Arrowhead dimensions
  const arrowHeadW = Math.max(3, Math.round(size * 0.14));
  const arrowHeadH = Math.max(4, Math.round(size * 0.18));
  const arcRadius = Math.round(size * 0.46);
  const arcThick = Math.max(1.5, Math.round(size * 0.075));

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          justifyContent: 'center',
          alignItems: 'center',
        },
        style,
      ]}
    >
      {/* Landscape phone silhouette */}
      <View
        style={{
          width: phoneW,
          height: phoneH,
          borderWidth: borderThick,
          borderColor: color,
          borderRadius: 3,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        {/* Inner screen bezel */}
        <View
          style={{
            width: innerW,
            height: innerH,
            borderWidth: 1,
            borderColor: color,
            borderRadius: 1.5,
            opacity: 0.85,
          }}
        />
      </View>

      {/* Top-right rotation arc */}
      <View
        style={{
          position: 'absolute',
          width: arcRadius * 2,
          height: arcRadius * 2,
          borderRadius: arcRadius,
          borderWidth: arcThick,
          borderColor: 'transparent',
          borderTopColor: color,
          borderRightColor: color,
          transform: [{ rotate: '-10deg' }],
        }}
      />

      {/* Top-right arrowhead (pointing downward) */}
      <View
        style={{
          position: 'absolute',
          top: Math.round(size * 0.28),
          right: Math.round(size * 0.01),
          width: 0,
          height: 0,
          borderStyle: 'solid',
          borderLeftWidth: arrowHeadW,
          borderRightWidth: arrowHeadW,
          borderTopWidth: arrowHeadH,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderTopColor: color,
        }}
      />

      {/* Bottom-left rotation arc */}
      <View
        style={{
          position: 'absolute',
          width: arcRadius * 2,
          height: arcRadius * 2,
          borderRadius: arcRadius,
          borderWidth: arcThick,
          borderColor: 'transparent',
          borderBottomColor: color,
          borderLeftColor: color,
          transform: [{ rotate: '-10deg' }],
        }}
      />

      {/* Bottom-left arrowhead (pointing upward) */}
      <View
        style={{
          position: 'absolute',
          bottom: Math.round(size * 0.28),
          left: Math.round(size * 0.01),
          width: 0,
          height: 0,
          borderStyle: 'solid',
          borderLeftWidth: arrowHeadW,
          borderRightWidth: arrowHeadW,
          borderBottomWidth: arrowHeadH,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderBottomColor: color,
        }}
      />
    </View>
  );
};

export const RotateArrowsIcon: React.FC<IconProps> = ({ size = 20, color = '#FFD600', style }) => {
  const arcThick = Math.max(1.8, Math.round(size * 0.09));
  const arrowW = Math.max(3, Math.round(size * 0.18));
  const arrowH = Math.max(4, Math.round(size * 0.22));

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          justifyContent: 'center',
          alignItems: 'center',
        },
        style,
      ]}
    >
      {/* Top-Right Arc */}
      <View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: arcThick,
          borderColor: 'transparent',
          borderTopColor: color,
          borderRightColor: color,
          transform: [{ rotate: '-25deg' }],
        }}
      />
      {/* Top-Right Arrowhead */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          right: Math.round(size * 0.22),
          width: 0,
          height: 0,
          borderStyle: 'solid',
          borderLeftWidth: arrowW,
          borderRightWidth: arrowW,
          borderBottomWidth: arrowH,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderBottomColor: color,
          transform: [{ rotate: '55deg' }],
        }}
      />

      {/* Bottom-Left Arc */}
      <View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: arcThick,
          borderColor: 'transparent',
          borderBottomColor: color,
          borderLeftColor: color,
          transform: [{ rotate: '-25deg' }],
        }}
      />
      {/* Bottom-Left Arrowhead */}
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: Math.round(size * 0.22),
          width: 0,
          height: 0,
          borderStyle: 'solid',
          borderLeftWidth: arrowW,
          borderRightWidth: arrowW,
          borderBottomWidth: arrowH,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderBottomColor: color,
          transform: [{ rotate: '-125deg' }],
        }}
      />

      {/* Center Phone Silhouette */}
      <View
        style={{
          width: Math.round(size * 0.35),
          height: Math.round(size * 0.52),
          borderWidth: 1.2,
          borderColor: color,
          borderRadius: 1.5,
          opacity: 0.85,
        }}
      />
    </View>
  );
};

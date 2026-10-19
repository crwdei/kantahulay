import React, { Component, ReactNode, ErrorInfo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
  scope?: 'root' | 'player';
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (__DEV__) {
      console.error('[ErrorBoundary caught error]', error, info?.componentStack);
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      const isRoot = this.props.scope !== 'player';
      return (
        <View style={[styles.container, isRoot ? styles.rootContainer : styles.playerContainer]}>
          <Text style={styles.title} numberOfLines={2}>
            {this.props.fallbackTitle || 'Something went wrong'}
          </Text>
          <Text style={styles.message} numberOfLines={3}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={this.handleRetry}
            accessibilityRole="button"
            accessibilityLabel={isRoot ? 'Reload Application' : 'Reload Player'}
          >
            <Text style={styles.buttonText}>{isRoot ? 'Reload' : 'Reload Player'}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#0B0D12',
  },
  rootContainer: {
    flex: 1,
  },
  playerContainer: {
    flex: 1,
    margin: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#283248',
  },
  title: {
    color: '#FFD600',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    color: '#A3ADBD',
    fontSize: 14,
    marginBottom: 20,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#FFD600',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 6,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: 'bold',
  },
});

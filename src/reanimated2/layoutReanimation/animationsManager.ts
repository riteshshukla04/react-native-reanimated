import { runOnUI } from '../core';
import { withStyleAnimation } from '../animation/styleAnimation';
import { SharedValue } from '../commonTypes';
import { makeUIMutable } from '../mutables';
import {
  LayoutAnimationFunction,
  LayoutAnimationsValues,
} from './animationBuilder';

const TAG_OFFSET = 1e9;

function startObservingProgress(
  tag: number,
  sharedValue: SharedValue<number>,
  animationType: string
): void {
  'worklet';
  const isSharedTransition = animationType === 'sharedElementTransition';
  sharedValue.addListener(tag + TAG_OFFSET, () => {
    _notifyAboutProgress(tag, sharedValue.value, isSharedTransition);
  });
}

function stopObservingProgress(
  tag: number,
  sharedValue: SharedValue<number>,
  cancelled: boolean,
  removeView: boolean
): void {
  'worklet';
  sharedValue.removeListener(tag + TAG_OFFSET);
  _notifyAboutEnd(tag, cancelled, removeView);
}

function createLayoutAnimationManager() {
  'worklet';
  const enteringAnimationForTag = new Map();
  const sharedTransitionForTag = new Map();
  const mutableValuesForTag = new Map();

  return {
    start(
      tag: number,
      type: string,
      yogaValues: LayoutAnimationsValues,
      config: LayoutAnimationFunction
    ) {
      const style = config(yogaValues);
      let currentAnimation = style.animations;

      if (type === 'entering') {
        enteringAnimationForTag.set(tag, currentAnimation);
      } else if (type === 'layout') {
        // When layout animation is requested, but entering is still running, we merge
        // new layout animation targets into the ongoing animation
        const enteringAnimation = enteringAnimationForTag.get(tag);
        if (enteringAnimation) {
          currentAnimation = { ...enteringAnimation, ...style.animations };
        }
      }

      let value = mutableValuesForTag.get(tag);
      if (value === undefined) {
        value = makeUIMutable(style.initialValues);
        mutableValuesForTag.set(tag, value);
      } else {
        if (!sharedTransitionForTag.get(tag)) {
          stopObservingProgress(tag, value, false, false);
        }
        value._value = style.initialValues;
      }

      if (type === 'sharedElementTransition') {
        sharedTransitionForTag.set(tag, currentAnimation);
      }

      // @ts-ignore The line below started failing because I added types to the method – don't have time to fix it right now
      const animation = withStyleAnimation(currentAnimation);

      animation.callback = (finished?: boolean) => {
        if (finished) {
          enteringAnimationForTag.delete(tag);
          sharedTransitionForTag.delete(tag);
          mutableValuesForTag.delete(tag);
          const shouldRemoveView = type === 'exiting';
          stopObservingProgress(tag, value, finished, shouldRemoveView);
        }
        style.callback &&
          style.callback(finished === undefined ? false : finished);
      };

      startObservingProgress(tag, value, type);
      value.value = animation;
    },
  };
}

runOnUI(() => {
  'worklet';
  global.LayoutAnimationsManager = createLayoutAnimationManager();
})();

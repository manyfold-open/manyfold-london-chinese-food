/**
 * A dish's picture, by the rule the site keeps (AGENTS.md, invariant 18): a real photo of this
 * dish at this place first; else the dish's approved AI illustration, always labeled, when the site
 * shows them and the reader has not turned them off; else nothing.
 */

import { appUrl } from '../base';
import { useAiPreference } from '../ai';
import { useCopy } from '../i18n';
import { Icon } from '../ui';

export interface DishPictureInput {
  photo: string | null;
  dish: string | null;
  name: string;
}

export function DishImage({
  photo,
  dish,
  name,
  illustrations,
  size = 'thumb',
}: DishPictureInput & { illustrations: { shown: boolean; dishes: Record<string, string> } | null; size?: 'thumb' | 'full' }) {
  const copy = useCopy();
  const [wanted] = useAiPreference();
  if (photo) {
    return (
      <span className="dish-image">
        <img src={appUrl(`/media/p/${photo}/${size}.webp`)} alt={name} loading="lazy" decoding="async" />
      </span>
    );
  }
  const illustration = dish && illustrations?.shown && wanted ? illustrations.dishes[dish] : undefined;
  if (illustration) {
    return (
      <span className="dish-image ai">
        <img src={appUrl(`/media/i/${illustration}/${size}.webp`)} alt={copy.ai.alt(name)} loading="lazy" decoding="async" />
        <span className="ai-badge">{copy.ai.badge}</span>
      </span>
    );
  }
  return (
    <span className="dish-image empty" aria-hidden="true">
      <Icon name="image" size={20} />
    </span>
  );
}

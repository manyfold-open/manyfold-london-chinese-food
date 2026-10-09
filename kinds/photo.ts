import { defineKind } from '../src/shared/kinds.ts';
import { PHOTO_SUBJECTS, PHOTO_SUBJECT_LABELS } from './vocab.ts';

/**
 * A photo a visitor took and uploaded here (CC BY 4.0). Stored only as the WebP the Images
 * binding re-encoded, with no metadata, and public only once a maintainer has looked at it.
 */
export default defineKind({
  kind: 'photo',
  title: { en: 'Photo', zh: '照片' },
  noun: { en: { one: 'photo', other: 'photos' }, zh: '张照片' },
  fields: {
    place: { type: 'ref', to: ['place'], required: true, label: { en: 'Place', zh: '店铺' } },
    subject: { type: 'enum', required: true, label: { en: 'What it shows', zh: '内容' }, values: PHOTO_SUBJECTS, valueLabels: PHOTO_SUBJECT_LABELS },
    dish_name: { type: 'text', max: 60, label: { en: 'Dish', zh: '菜名' }, help: 'The dish shown, as the menu names it.' },
    caption: { type: 'text', max: 200, label: { en: 'Caption', zh: '说明' } },
    attribution: { type: 'text', max: 60, label: { en: 'Taken by', zh: '拍摄者' }, help: 'The name the visitor wants shown, if any.' },
    width: { type: 'number', server: true, label: { en: 'Width', zh: '宽' } },
    height: { type: 'number', server: true, label: { en: 'Height', zh: '高' } },
    license: { type: 'text', max: 20, server: true, label: { en: 'Licence', zh: '许可' } },
    set: { type: 'text', max: 40, server: true, label: { en: 'Pages of', zh: '同一组' }, help: 'The first photo of the pages of one menu sent together.' },
    page_no: { type: 'number', server: true, label: { en: 'Page', zh: '页' } },
  },
  parent: 'place',
  identity: [],
  provenance: 'upload',
  submit: 'visitor-uploads',
  rules: [
    { rule: 'requiredWhen', field: 'dish_name', when: { subject: 'dish' } },
    { rule: 'noRating', fields: ['caption'] },
  ],
  updatable: false,
  recheckAfterDays: null,
  pendingCap: { start: 0, max: 0 },
  example: { data: { place: 'rec_01k70q4mgw8b1r7f3s5t9v2x4y', subject: 'dish', dish_name: '虾饺' }, source_url: '', evidence: '' },
  scope: {
    in: 'Photos visitors took at a place: its dishes, its menu, outside and inside.',
    out: "Photos of people; screenshots; photos copied from another site; anything unrelated to the place.",
  },
  sourceHints: [],
  maintainerChecks: [
    'It shows what its subject says, at a place like this one; for a dish, the dish it names.',
    'No one can be recognized in it: no faces, no name badges.',
    'It was taken, not copied: no screen, watermark or logo of another site.',
    'Nothing offensive or unrelated.',
  ],
  display: ['dish_name', 'subject'],
});

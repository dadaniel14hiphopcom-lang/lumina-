import {
  DirectThread,
  NotificationItem,
  Post,
  StoryItem,
  UserProfile,
} from '../types';

export const ASSETS = {
  avatarClara: '/src/assets/images/avatar_clara_1795293856478.jpg',
  avatarLucas: '/src/assets/images/avatar_lucas_1795293860310.jpg',
  avatarMarina: '/src/assets/images/avatar_marina_1795293860057.jpg',
  avatarRafael: '/src/assets/images/avatar_rafael_1795293859505.jpg',
  postArchitecture: '/src/assets/images/post_architecture_1795293860401.jpg',
  postCoffeeLatte: '/src/assets/images/post_coffee_latte_1795293859590.jpg',
  postCoastalSunset: '/src/assets/images/post_coastal_sunset_1795293859985.jpg',
  postCeramicStudio: '/src/assets/images/post_ceramic_studio_1795293859756.jpg',
  postNightStreet: '/src/assets/images/post_night_street_1795293860103.jpg',
  postBotanicalLoft: '/src/assets/images/post_botanical_loft_1795293860092.jpg',
};

export const STUDIO_SAMPLE_IMAGES = [
  { label: 'Arquitetura Brutalista', url: ASSETS.postArchitecture },
  { label: 'Café Artesanal', url: ASSETS.postCoffeeLatte },
  { label: 'Costa ao Pôr do Sol', url: ASSETS.postCoastalSunset },
  { label: 'Ateliê de Cerâmica', url: ASSETS.postCeramicStudio },
  { label: 'Rua Noturna', url: ASSETS.postNightStreet },
  { label: 'Loft Botânico', url: ASSETS.postBotanicalLoft },
];

const now = Date.now();
const min = 60 * 1000;
const hour = 60 * min;

export const SEED_USERS: UserProfile[] = [
  {
    id: 'user_daniel',
    username: 'daniel.silva',
    displayName: 'Daniel Silva',
    avatarUrl: ASSETS.avatarRafael,
    coverUrl: ASSETS.postArchitecture,
    bio: 'Direção criativa, fotografia 35mm e arquitetura contemporânea. São Paulo.',
    website: 'lumina.social/daniel',
    verified: true,
    isOnline: true,
    isDemoSeed: true,
    restricted: false,
    boosted: false,
    followers: ['user_clara', 'user_lucas', 'user_marina'],
    following: ['user_clara', 'user_lucas', 'user_marina', 'user_rafael'],
  },
  {
    id: 'user_clara',
    username: 'clara.lentes',
    displayName: 'Clara Mendes',
    avatarUrl: ASSETS.avatarClara,
    coverUrl: ASSETS.postCoastalSunset,
    bio: 'Fotógrafa documental em filme analógico. Luz natural e retratos urbanos.',
    website: 'claramendes.studio',
    verified: true,
    isOnline: true,
    isDemoSeed: true,
    restricted: false,
    boosted: true,
    followers: ['user_daniel', 'user_lucas', 'user_marina', 'user_rafael'],
    following: ['user_daniel', 'user_marina'],
  },
  {
    id: 'user_lucas',
    username: 'lucas.arq',
    displayName: 'Lucas Andrade',
    avatarUrl: ASSETS.avatarLucas,
    coverUrl: ASSETS.postBotanicalLoft,
    bio: 'Arquiteto. Concreto aparente, madeira nativa e casas integradas à mata.',
    website: 'andrade.arq.br',
    verified: true,
    isOnline: true,
    isDemoSeed: true,
    restricted: false,
    boosted: false,
    followers: ['user_daniel', 'user_clara', 'user_rafael'],
    following: ['user_daniel', 'user_clara'],
  },
  {
    id: 'user_marina',
    username: 'marina.mesa',
    displayName: 'Marina Vasconcelos',
    avatarUrl: ASSETS.avatarMarina,
    coverUrl: ASSETS.postCeramicStudio,
    bio: 'Cozinha sazonal, cafés especiais e cerâmica feita à mão.',
    isOnline: false,
    isDemoSeed: true,
    restricted: false,
    boosted: false,
    followers: ['user_daniel', 'user_clara', 'user_lucas'],
    following: ['user_daniel', 'user_clara', 'user_lucas'],
  },
  {
    id: 'user_rafael',
    username: 'rafael.35mm',
    displayName: 'Rafael Costa',
    avatarUrl: ASSETS.avatarRafael,
    coverUrl: ASSETS.postNightStreet,
    bio: 'Cinegrafista & colorista. Narrativas noturnas e paisagens costeiras.',
    verified: false,
    isOnline: true,
    isDemoSeed: true,
    restricted: false,
    boosted: false,
    followers: ['user_daniel', 'user_marina'],
    following: ['user_clara', 'user_lucas'],
  },
];

export const SEED_POSTS: Post[] = [
  {
    id: 'post_1',
    authorId: 'user_lucas',
    media: [
      {
        id: 'm_1a',
        url: ASSETS.postArchitecture,
        alt: 'Casa de concreto aparente cercada pela Mata Atlântica ao amanhecer',
      },
      {
        id: 'm_1b',
        url: ASSETS.postBotanicalLoft,
        alt: 'Interior ensolarado com janelas industriais e plantas tropicais',
      },
    ],
    caption:
      'Manhã de sol filtrado na Casa Mirante. O concreto bruto dialoga com a umidade da Mata Atlântica sem disputar espaço com a paisagem. Deslize para ver o interior. #arquitetura #brutalismo #designbrasileiro',
    location: 'Ilhabela, SP',
    category: 'Arquitetura',
    aspectRatio: '4:5',
    likes: ['user_clara', 'user_marina', 'user_rafael'],
    savedBy: ['user_daniel'],
    comments: [
      {
        id: 'c_1',
        userId: 'user_clara',
        text: 'Essa luz atravessando o terraço ficou surreal, Lucas.',
        createdAt: now - 95 * min,
        likes: ['user_lucas', 'user_daniel'],
        replies: [
          {
            id: 'r_1',
            userId: 'user_lucas',
            text: 'Chegamos às 6h15 para pegar exatamente esse ângulo do sol!',
            createdAt: now - 70 * min,
            likes: ['user_clara'],
          },
        ],
      },
      {
        id: 'c_2',
        userId: 'user_marina',
        text: 'A integração com a varanda verde é um sonho.',
        createdAt: now - 40 * min,
        likes: [],
        replies: [],
      },
    ],
    createdAt: now - 2 * hour,
  },
  {
    id: 'post_2',
    authorId: 'user_marina',
    media: [
      {
        id: 'm_2',
        url: ASSETS.postCoffeeLatte,
        alt: 'Xícara de cerâmica artesanal com latte art sobre mesa de travertino',
      },
    ],
    caption:
      'Caderno de anotações, travertino e o primeiro espresso da manhã com grãos da Serra da Mantiqueira. Pequenos rituais antes de abrir o ateliê. #cafe #gastronomia #ceramica',
    location: 'Pinheiros, São Paulo',
    category: 'Gastronomia',
    aspectRatio: '1:1',
    likes: ['user_daniel', 'user_clara', 'user_lucas', 'user_rafael'],
    savedBy: [],
    comments: [
      {
        id: 'c_3',
        userId: 'user_daniel',
        text: 'Preciso passar aí ainda esta semana para provar essa torra.',
        createdAt: now - 3 * hour,
        likes: ['user_marina'],
        replies: [],
      },
    ],
    createdAt: now - 4 * hour,
  },
  {
    id: 'post_3',
    authorId: 'user_clara',
    media: [
      {
        id: 'm_3',
        url: ASSETS.postCeramicStudio,
        alt: 'Vasos de cerâmica fosca sobre bancada de carvalho iluminada pela janela',
      },
    ],
    caption:
      'Série documental sobre ofícios manuais. Passei a tarde fotografando o torno e as texturas de argila crua com filme 35mm em luz natural. #fotografia #arte #analogico',
    location: 'Tiradentes, MG',
    category: 'Arte',
    aspectRatio: '4:5',
    isReel: true,
    audioTrack: 'Claridade Acústica · Tom & Violão',
    likes: ['user_daniel', 'user_marina', 'user_lucas'],
    savedBy: ['user_daniel', 'user_marina'],
    comments: [
      {
        id: 'c_4',
        userId: 'user_rafael',
        text: 'A textura da madeira com a luz da janela parece pintura.',
        createdAt: now - 5 * hour,
        likes: ['user_clara'],
        replies: [],
      },
    ],
    createdAt: now - 7 * hour,
  },
  {
    id: 'post_4',
    authorId: 'user_rafael',
    media: [
      {
        id: 'm_4',
        url: ASSETS.postNightStreet,
        alt: 'Rua noturna após a chuva com reflexos quentes de postes no asfalto',
      },
    ],
    caption:
      'Depois da chuva, toda rua vira um espelho cinematográfico. Rodando testes noturnos em 50mm f/1.4 sem iluminação artificial extra. #cinema #fotografia #noite',
    location: 'Centro, Rio de Janeiro',
    category: 'Fotografia',
    aspectRatio: '9:16',
    isReel: true,
    audioTrack: 'Chuva de Neon · Instrumental Lo-Fi',
    likes: ['user_clara', 'user_daniel'],
    savedBy: [],
    comments: [],
    createdAt: now - 11 * hour,
  },
  {
    id: 'post_5',
    authorId: 'user_clara',
    media: [
      {
        id: 'm_5',
        url: ASSETS.postCoastalSunset,
        alt: 'Falésias costeiras douradas e ondas turquesa ao pôr do sol',
      },
    ],
    caption:
      'O último brilho dourado batendo nas falésias antes do anoitecer. Vento forte, maresia na lente e silêncio absoluto. #viagem #natureza #35mm',
    location: 'Arraial do Cabo, RJ',
    category: 'Viagem',
    aspectRatio: '4:5',
    likes: ['user_daniel', 'user_lucas', 'user_marina', 'user_rafael'],
    savedBy: ['user_clara'],
    comments: [],
    createdAt: now - 18 * hour,
  },
  {
    id: 'post_6',
    authorId: 'user_daniel',
    media: [
      {
        id: 'm_6',
        url: ASSETS.postBotanicalLoft,
        alt: 'Sala minimalista iluminada com janelas amplas e plantas tropicais',
      },
    ],
    caption:
      'Luz da tarde no novo estúdio. Menos móveis, mais respiro e folhas de costela-de-adão crescendo rápido perto da janela. #design #interiores #estudiocriativo',
    location: 'Vila Madalena, SP',
    category: 'Design',
    aspectRatio: '4:5',
    likes: ['user_clara', 'user_lucas', 'user_marina'],
    savedBy: [],
    comments: [
      {
        id: 'c_5',
        userId: 'user_lucas',
        text: 'Essa esquadria preta valorizou demais o pé-direito.',
        createdAt: now - 20 * hour,
        likes: ['user_daniel'],
        replies: [],
      },
    ],
    createdAt: now - 24 * hour,
  },
];

export const SEED_STORIES: StoryItem[] = [
  {
    id: 'story_1',
    authorId: 'user_clara',
    mediaUrl: ASSETS.postCoastalSunset,
    caption: 'Golden hour na trilha costeira',
    location: 'Arraial do Cabo',
    createdAt: now - 2 * hour,
    viewedBy: [],
    reactions: [],
  },
  {
    id: 'story_2',
    authorId: 'user_clara',
    mediaUrl: ASSETS.postCeramicStudio,
    caption: 'Bastidores do ensaio de hoje',
    createdAt: now - 1 * hour,
    viewedBy: [],
    reactions: [],
  },
  {
    id: 'story_3',
    authorId: 'user_lucas',
    mediaUrl: ASSETS.postArchitecture,
    caption: 'Visita técnica na obra em Ilhabela',
    location: 'Ilhabela, SP',
    createdAt: now - 3 * hour,
    viewedBy: [],
    reactions: [],
  },
  {
    id: 'story_4',
    authorId: 'user_marina',
    mediaUrl: ASSETS.postCoffeeLatte,
    caption: 'Nova safra da Mantiqueira chegou',
    createdAt: now - 5 * hour,
    viewedBy: ['user_daniel'],
    reactions: [],
  },
  {
    id: 'story_5',
    authorId: 'user_rafael',
    mediaUrl: ASSETS.postNightStreet,
    caption: 'Testando lente 50mm na chuva',
    createdAt: now - 6 * hour,
    viewedBy: [],
    reactions: [],
  },
];

export const SEED_THREADS: DirectThread[] = [
  {
    id: 'thread_clara',
    participantIds: ['user_daniel', 'user_clara'],
    unreadBy: ['user_daniel'],
    updatedAt: now - 25 * min,
    messages: [
      {
        id: 'dm_1',
        senderId: 'user_clara',
        text: 'Oi Daniel! Vi as fotos do estúdio novo, a luz da janela ficou incrível.',
        createdAt: now - 60 * min,
      },
      {
        id: 'dm_2',
        senderId: 'user_daniel',
        text: 'Valeu Clara! Quando quiser fazer um ensaio por aqui é só avisar.',
        createdAt: now - 40 * min,
      },
      {
        id: 'dm_3',
        senderId: 'user_clara',
        text: 'Fechado! Vou levar a câmera média formato na quinta.',
        createdAt: now - 25 * min,
        reaction: '❤️',
      },
    ],
  },
  {
    id: 'thread_lucas',
    participantIds: ['user_daniel', 'user_lucas'],
    unreadBy: [],
    updatedAt: now - 3 * hour,
    messages: [
      {
        id: 'dm_4',
        senderId: 'user_lucas',
        text: 'Te mandei o rascunho da planta baixa do estúdio.',
        createdAt: now - 4 * hour,
      },
      {
        id: 'dm_5',
        senderId: 'user_daniel',
        text: 'Recebido! Ficou super limpo o layout.',
        createdAt: now - 3 * hour,
      },
    ],
  },
  {
    id: 'thread_marina',
    participantIds: ['user_daniel', 'user_marina'],
    unreadBy: [],
    updatedAt: now - 8 * hour,
    messages: [
      {
        id: 'dm_6',
        senderId: 'user_marina',
        text: 'Separei um pacote do café novo pra você experimentar.',
        createdAt: now - 8 * hour,
      },
    ],
  },
];

export const SEED_NOTIFICATIONS: NotificationItem[] = [
  {
    id: 'notif_1',
    recipientId: 'user_daniel',
    actorId: 'user_clara',
    type: 'like',
    postId: 'post_6',
    createdAt: now - 18 * min,
    read: false,
  },
  {
    id: 'notif_2',
    recipientId: 'user_daniel',
    actorId: 'user_lucas',
    type: 'comment',
    postId: 'post_6',
    text: 'Essa esquadria preta valorizou demais o pé-direito.',
    createdAt: now - 2 * hour,
    read: false,
  },
  {
    id: 'notif_3',
    recipientId: 'user_daniel',
    actorId: 'user_marina',
    type: 'follow',
    createdAt: now - 6 * hour,
    read: true,
  },
];

# Dustin-Chain 프로젝트 컨텍스트

## 🎯 프로젝트 목표
Ethereum 2.0 스타일의 블록체인 구현 (Proof of Stake, Slots, Epochs)

## 🏗️ 현재 아키텍처
- **StateManager**: LevelDB 기반 상태 관리 (캐시 + 저널링 + DB)
- **AccountService**: StateManager 사용하여 계정 관리
- **BlockService**: 아직 StateManager 미연동 (다음 작업)
- **글로벌 모듈**: CommonModule, StateModule

## 🔧 주요 기술 스택
- NestJS, TypeScript, LevelDB, RLP, Keccak-256, Merkle Patricia Trie

## 📋 현재 상태
- 1단계 완료: StateManager 기반 아키텍처 구축
- 2단계 예정: BlockService StateManager 연동
- Genesis 계정 정상 동작 (50+ DSTN)
- 저널링 시스템 작동 중 (commitBlock() 호출 필요)

## 🚨 중요 사항
- StateManager는 글로벌 모듈로 설정됨
- LevelDB 오류 수정 완료 (DB 상태 확인 후 접근)
- TODO.md 파일에 상세한 진행 상황 기록

## 🔄 다음 작업
BlockService에 StateManager 의존성 주입 및 commitBlock() 호출

/** App-owned first-deployment contracts. Existing development resources are not migration targets.
 * Canvas/Doc fields follow current adapters and verified schemas; Sketch follows its fresh private contract; Image follows its independent backend. */
export interface AttributeSpec {key:string;type:"string"|"integer";required:boolean;size?:number;min?:number;max?:number}
export interface IndexSpec {key:string;type:"key"|"unique";attributes:string[]}
export interface CollectionSpec {id:string;name:string;attributes:AttributeSpec[];indexes:IndexSpec[]}
export interface AppStorageSpec {databaseName:string;bucketName:string;maximumFileSize:number;runtimeNamespace:boolean;collections:CollectionSpec[]}
export const PRIVATE_STORAGE_CONTRACT_VERSION="designai-private-storage/v1";
export const PRIVATE_STORAGE_SCHEMAS:Record<string,AppStorageSpec> = {
  "canvas": {
    "databaseName": "Canvas private application storage v1",
    "bucketName": "Canvas private application assets v1",
    "maximumFileSize": 30000000,
    "runtimeNamespace": true,
    "collections": [
      {
        "id": "canvases",
        "name": "Canvases",
        "attributes": [
          {
            "key": "revision",
            "type": "integer",
            "required": true,
            "min": 0,
            "max": 9007199254740991
          },
          {
            "key": "state",
            "type": "string",
            "required": true,
            "size": 10000000
          },
          {
            "key": "operations",
            "type": "string",
            "required": false,
            "size": 16777215
          },
          {
            "key": "snapshots",
            "type": "string",
            "required": false,
            "size": 16777215
          },
          {
            "key": "extra",
            "type": "string",
            "required": false,
            "size": 16777215
          },
          {
            "key": "teamId",
            "type": "string",
            "required": false,
            "size": 200
          },
          {
            "key": "createdBy",
            "type": "string",
            "required": false,
            "size": 200
          },
          {
            "key": "assetMetadata",
            "type": "string",
            "required": false,
            "size": 16777215
          }
        ],
        "indexes": []
      },
      {
        "id": "canvas_files",
        "name": "Canvas Files",
        "attributes": [
          {
            "key": "path",
            "type": "string",
            "required": true,
            "size": 500
          },
          {
            "key": "fileId",
            "type": "string",
            "required": true,
            "size": 64
          },
          {
            "key": "kind",
            "type": "string",
            "required": true,
            "size": 32
          },
          {
            "key": "mime",
            "type": "string",
            "required": true,
            "size": 64
          },
          {
            "key": "sha256",
            "type": "string",
            "required": true,
            "size": 128
          },
          {
            "key": "createdAt",
            "type": "string",
            "required": true,
            "size": 64
          },
          {
            "key": "size",
            "type": "integer",
            "required": true,
            "min": 0,
            "max": 30000000
          },
          {
            "key": "canvasId",
            "type": "string",
            "required": true,
            "size": 160
          }
        ],
        "indexes": [
          {
            "key": "canvas_path_unique",
            "type": "unique",
            "attributes": [
              "canvasId",
              "path"
            ]
          },
          {
            "key": "canvas_id_idx",
            "type": "key",
            "attributes": [
              "canvasId"
            ]
          },
          {"key":"canvas_kind_idx","type":"key","attributes":["canvasId","kind"]}
        ]
      },
      {
        "id": "canvas_operations",
        "name": "Canvas Operations",
        "attributes": [
          {
            "key": "canvasId",
            "type": "string",
            "required": true,
            "size": 160
          },
          {
            "key": "fingerprint",
            "type": "string",
            "required": true,
            "size": 128
          },
          {
            "key": "receipt",
            "type": "string",
            "required": true,
            "size": 2000000
          },
          {
            "key": "before",
            "type": "string",
            "required": true,
            "size": 10000000
          },
          {
            "key": "after",
            "type": "string",
            "required": true,
            "size": 10000000
          },
          {
            "key": "operationId",
            "type": "string",
            "required": true,
            "size": 160
          }
        ],
        "indexes": [
          {
            "key": "canvas_op_unique",
            "type": "unique",
            "attributes": [
              "canvasId",
              "operationId"
            ]
          }
        ]
      },
      {
        "id": "apps",
        "name": "Apps",
        "attributes": [
          {
            "key": "appId",
            "type": "string",
            "required": true,
            "size": 2000
          },
          {
            "key": "name",
            "type": "string",
            "required": true,
            "size": 2000
          },
          {
            "key": "endpoint",
            "type": "string",
            "required": true,
            "size": 2000
          },
          {
            "key": "description",
            "type": "string",
            "required": true,
            "size": 2000
          },
          {
            "key": "status",
            "type": "string",
            "required": true,
            "size": 2000
          },
          {
            "key": "registeredAt",
            "type": "string",
            "required": true,
            "size": 2000
          },
          {
            "key": "webUrl",
            "type": "string",
            "required": false,
            "size": 500
          },
          {
            "key": "scope",
            "type": "string",
            "required": false,
            "size": 32
          },
          {
            "key": "teamId",
            "type": "string",
            "required": false,
            "size": 64
          }
        ],
        "indexes": []
      },
      {
        "id": "card_packs",
        "name": "Card Packs",
        "attributes": [
          {
            "key": "packId",
            "type": "string",
            "required": true,
            "size": 2000
          },
          {
            "key": "team",
            "type": "string",
            "required": true,
            "size": 2000
          },
          {
            "key": "name",
            "type": "string",
            "required": true,
            "size": 2000
          },
          {
            "key": "version",
            "type": "string",
            "required": true,
            "size": 2000
          },
          {
            "key": "renderEntry",
            "type": "string",
            "required": true,
            "size": 2000
          },
          {
            "key": "status",
            "type": "string",
            "required": true,
            "size": 2000
          },
          {
            "key": "updatedAt",
            "type": "string",
            "required": true,
            "size": 2000
          },
          {
            "key": "kinds",
            "type": "string",
            "required": true,
            "size": 16777215
          },
          {
            "key": "ops",
            "type": "string",
            "required": true,
            "size": 16777215
          },
          {
            "key": "editorApps",
            "type": "string",
            "required": true,
            "size": 16000000
          }
        ],
        "indexes": []
      },
      {
        "id": "card_grants",
        "name": "Card Grants",
        "attributes": [
          {
            "key": "scope",
            "type": "string",
            "required": true,
            "size": 2000
          },
          {
            "key": "source",
            "type": "string",
            "required": true,
            "size": 2000
          },
          {
            "key": "updatedAt",
            "type": "string",
            "required": true,
            "size": 2000
          },
          {
            "key": "allowedKinds",
            "type": "string",
            "required": true,
            "size": 16777215
          }
        ],
        "indexes": []
      },
      {
        "id": "app_runtime_state",
        "name": "App durable runtime state",
        "attributes": [
          {
            "key": "namespace",
            "type": "string",
            "required": true,
            "size": 240
          },
          {
            "key": "slot",
            "type": "string",
            "required": true,
            "size": 240
          },
          {
            "key": "payload",
            "type": "string",
            "required": true,
            "size": 1048576
          },
          {
            "key": "updatedAt",
            "type": "string",
            "required": true,
            "size": 64
          },
          {
            "key": "revision",
            "type": "integer",
            "required": true,
            "min": 0,
            "max": 9007199254740991
          }
        ],
        "indexes": [
          {
            "key": "runtime_namespace",
            "type": "key",
            "attributes": [
              "namespace"
            ]
          }
        ]
      }
    ]
  },
  "doc": {
    "databaseName": "Doc private application storage v1",
    "bucketName": "Doc private application assets v1",
    "maximumFileSize": 30000000,
    "runtimeNamespace": true,
    "collections": [
      {
        "id": "documents",
        "name": "Documents",
        "attributes": [
          {
            "key": "name",
            "type": "string",
            "required": true,
            "size": 500
          },
          {
            "key": "path",
            "type": "string",
            "required": true,
            "size": 500
          },
          {
            "key": "fileId",
            "type": "string",
            "required": true,
            "size": 200
          },
          {
            "key": "size",
            "type": "integer",
            "required": true,
            "min": 0,
            "max": 9007199254740991
          },
          {
            "key": "updatedAt",
            "type": "string",
            "required": true,
            "size": 64
          },
          {
            "key": "teamId",
            "type": "string",
            "required": false,
            "size": 200
          },
          {
            "key": "bizId",
            "type": "string",
            "required": false,
            "size": 200
          },
          {
            "key": "createdBy",
            "type": "string",
            "required": false,
            "size": 200
          },
          {
            "key": "nodeId",
            "type": "string",
            "required": false,
            "size": 200
          },
          {
            "key": "mirrorCanvasId",
            "type": "string",
            "required": false,
            "size": 200
          },
          {
            "key": "mirrorPath",
            "type": "string",
            "required": false,
            "size": 2000
          },
          {
            "key": "archivedAt",
            "type": "string",
            "required": false,
            "size": 200
          },
          {
            "key": "providerRevision",
            "type": "integer",
            "required": false,
            "min": 1,
            "max": 9007199254740991
          },
          {
            "key": "maApplicationId",
            "type": "string",
            "required": false,
            "size": 160
          },
          {
            "key": "maApplicationInstanceId",
            "type": "string",
            "required": false,
            "size": 160
          },
          {
            "key": "maProviderInstanceId",
            "type": "string",
            "required": false,
            "size": 160
          }
        ],
        "indexes": [
          {
            "key": "document_path_unique",
            "type": "unique",
            "attributes": [
              "path"
            ]
          }
        ]
      },
      {
        "id": "app_runtime_state",
        "name": "App durable runtime state",
        "attributes": [
          {
            "key": "namespace",
            "type": "string",
            "required": true,
            "size": 240
          },
          {
            "key": "slot",
            "type": "string",
            "required": true,
            "size": 240
          },
          {
            "key": "payload",
            "type": "string",
            "required": true,
            "size": 1048576
          },
          {
            "key": "updatedAt",
            "type": "string",
            "required": true,
            "size": 64
          },
          {
            "key": "revision",
            "type": "integer",
            "required": true,
            "min": 0,
            "max": 9007199254740991
          }
        ],
        "indexes": [
          {
            "key": "runtime_namespace",
            "type": "key",
            "attributes": [
              "namespace"
            ]
          }
        ]
      }
    ]
  },
  "sketch": {
    "databaseName": "Sketch isolated service storage",
    "bucketName": "Sketch private application assets v1",
    "maximumFileSize": 30000000,
    "runtimeNamespace": false,
    "collections": [
      {
        "id": "sketches",
        "name": "Sketches",
        "attributes": [
          {
            "key": "name",
            "type": "string",
            "size": 500,
            "required": true
          },
          {
            "key": "path",
            "type": "string",
            "size": 500,
            "required": true
          },
          {
            "key": "fileId",
            "type": "string",
            "size": 200,
            "required": true
          },
          {
            "key": "size",
            "type": "integer",
            "min": 0,
            "max": 9007199254740991,
            "required": true
          },
          {
            "key": "updatedAt",
            "type": "string",
            "size": 64,
            "required": true
          },
          {
            "key": "teamId",
            "type": "string",
            "size": 160,
            "required": false
          },
          {
            "key": "bizId",
            "type": "string",
            "size": 200,
            "required": false
          },
          {
            "key": "createdBy",
            "type": "string",
            "size": 160,
            "required": false
          },
          {
            "key": "nodeId",
            "type": "string",
            "size": 200,
            "required": false
          },
          {
            "key": "mirrorCanvasId",
            "type": "string",
            "size": 160,
            "required": false
          },
          {
            "key": "mirrorPath",
            "type": "string",
            "size": 500,
            "required": false
          },
          {
            "key": "archivedAt",
            "type": "string",
            "size": 64,
            "required": false
          },
          {
            "key": "revision",
            "type": "string",
            "size": 64,
            "required": false
          },
          {
            "key": "bindingKey",
            "type": "string",
            "size": 80,
            "required": false
          },
          {
            "key": "providerRevision",
            "type": "integer",
            "min": 0,
            "max": 9007199254740991,
            "required": false
          },
          {
            "key": "maApplicationId",
            "type": "string",
            "size": 160,
            "required": false
          },
          {
            "key": "maApplicationInstanceId",
            "type": "string",
            "size": 160,
            "required": false
          },
          {
            "key": "maProviderInstanceId",
            "type": "string",
            "size": 160,
            "required": false
          }
        ],
        "indexes": [
          {
            "key": "sketch_binding_unique",
            "type": "unique",
            "attributes": [
              "bindingKey"
            ]
          },
          {"key":"sketch_team_idx","type":"key","attributes":["teamId"]}
        ]
      },
      {
        "id": "app_runtime_state",
        "name": "App runtime state",
        "attributes": [
          {
            "key": "namespace",
            "type": "string",
            "size": 200,
            "required": true
          },
          {
            "key": "slot",
            "type": "string",
            "size": 200,
            "required": true
          },
          {
            "key": "revision",
            "type": "integer",
            "min": 0,
            "max": 9007199254740991,
            "required": true
          },
          {
            "key": "payload",
            "type": "string",
            "size": 1000000,
            "required": true
          },
          {
            "key": "updatedAt",
            "type": "string",
            "size": 64,
            "required": true
          }
        ],
        "indexes": []
      }
    ]
  },
  "image": {
    "databaseName": "Image App independent business",
    "bucketName": "Image private application assets v1",
    "maximumFileSize": 30000000,
    "runtimeNamespace": true,
    "collections": [
      {
        "id": "app_runtime_state",
        "name": "Image App business state",
        "attributes": [
          {
            "key": "namespace",
            "type": "string",
            "size": 240,
            "required": true
          },
          {
            "key": "slot",
            "type": "string",
            "size": 240,
            "required": true
          },
          {
            "key": "payload",
            "type": "string",
            "size": 1048576,
            "required": true
          },
          {
            "key": "updatedAt",
            "type": "string",
            "size": 64,
            "required": true
          },
          {
            "key": "revision",
            "type": "integer",
            "min": 0,
            "required": true
          }
        ],
        "indexes": [
          {
            "key": "image_runtime_namespace",
            "type": "key",
            "attributes": [
              "namespace"
            ]
          }
        ]
      }
    ]
  }
};
